import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getServerSupabase, getAdminSupabase } from '@/lib/supabase/server';
import { isStripeConfigured } from '@/lib/stripe/client';
import { AccreditoGiaUscitoConAltroImporto, RimborsoInAttesaDellaDivisione, refundOrder } from '@/lib/stripe/payout';
import { logger } from '@/lib/logger';
import { withAuthRateLimit } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { COLONNE_124, conRipiegoSchema, senzaColonne } from '@/lib/db/migrazione-124';
import { chiComandaIlReso } from '../../chi-comanda-il-reso';
import {
  motivoNienteDaRestituire,
  quantoSiPuoRestituire,
  type OrdineDaRimborsare,
} from '@/lib/rimborsi/regole-del-rimborso';
import { comeTornanoIContanti, leggiLaSceltaDelReso } from '@/lib/rimborsi/scelta-del-reso';
import { COLONNE_162 } from '@/lib/rimborsi/scelta-del-cliente';
import { scriviAncheSeMancaUnaColonnaNuova } from '@/lib/db/migrazione-148';
import { dimenticaLIbanSeNonServe } from '@/lib/rimborsi/iban-del-rimborso';
import { avvisoDelRimborsoNonRegistrato, RIMBORSO_PARTITO_MA_NON_REGISTRATO } from '@/lib/rimborsi/bonifici-da-fare';
import { notifyAdmins } from '@/lib/stripe/webhook/comune';

export const runtime = 'nodejs';

const Body = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  notes: z.string().max(1000).optional(),
  refundAmountCents: z.number().int().positive().optional(),
});

/**
 * Seller decide sul reso (APPROVED o REJECTED). Se APPROVED ed e' stato
 * fornito refundAmountCents, emette subito un rimborso parziale Stripe;
 * altrimenti il rimborso e' lasciato a quando il pacco torna indietro
 * (transizione RECEIVED -> REFUNDED via altro endpoint).
 */
async function handler(req: NextRequest, user: { id: string }, params: { id: string }): Promise<NextResponse> {
  let body;
  try {
    body = Body.parse(await jsonRichiesta(req, TETTO_JSON));
  } catch (e) {
    return ApiErrors.invalidRequest('Dati non validi', e instanceof Error ? e.message : undefined);
  }

  const supa = await getServerSupabase();
  const { data: ret, error } = await supa
    .from('returns')
    .select('id, status, seller_id, buyer_id, order_id, reason, refund_amount_cents')
    .eq('id', params.id)
    .single();

  if (error || !ret) return ApiErrors.notFound('Reso non trovato');

  /**
   * 3/9/2026 — IL NEGOZIO LO DICE L'ORDINE, NON IL RESO.
   *
   * Stessa riga sbagliata di `avanza`, e per lo stesso motivo: `ret.seller_id`
   * e' un campo della riga del reso, e la riga la scriveva il cliente. Chi
   * decide su un reso e' il venditore dell'ORDINE (oppure un amministratore),
   * e lo si legge dal server. La regola sta in un posto solo per tutte e due
   * le rotte: quando si corregge, si corregge ovunque.
   */
  const comando = await chiComandaIlReso(ret.order_id, user.id);
  if (!comando.autorizzato) {
    return comando.motivo === 'ordine-mancante'
      ? ApiErrors.notFound('Ordine del reso non trovato')
      : ApiErrors.forbidden();
  }

  if (ret.status !== 'REQUESTED') {
    return ApiErrors.conflict('Questo reso è già stato deciso.');
  }

  const admin = getAdminSupabase();

  // 🟠-22: il recesso (CHANGED_MIND) entro 14 giorni è INCONDIZIONATO (Cod. Cons.
  // art. 52-59): il venditore non può rifiutarlo. Può solo approvarlo ed elaborare
  // il rimborso (eventualmente alla restituzione del bene). Gli altri motivi
  // (danneggiato, sbagliato, ecc.) restano valutabili.
  if (ret.reason === 'CHANGED_MIND' && body.decision === 'REJECTED') {
    return ApiErrors.invalidRequest(
      'Il recesso entro 14 giorni è incondizionato e non può essere rifiutato (Cod. Cons. art. 52-59): approva ed elabora il rimborso.',
    );
  }

  /**
   * 27/8/2026 (R138) — IL TETTO SULL'IMPORTO ARRIVAVA TROPPO TARDI, E IN FORMA
   * DI GUASTO.
   *
   * Lo schema del corpo accettava qualunque importo positivo, e la
   * rivendicazione scriveva su `returns.refund_amount_cents` l'importo CHIESTO,
   * non quello uscito. Il tetto vero stava a valle, dentro `refundOrder`, che
   * su un residuo a zero solleva un errore tecnico: quell'errore usciva come
   * 502 con il messaggio interno in chiaro. Al venditore arrivava «Rimborso
   * fallito: refundOrder: importo rimborso non valido» invece di «l'ordine e'
   * gia' stato rimborsato per intero», e nel pannello restava un numero che non
   * corrisponde a nessun movimento.
   *
   * Il controllo sta adesso PRIMA della rivendicazione: cosi' un importo
   * impossibile non lascia nessuna traccia sul reso, e l'importo scritto e'
   * quello che esce davvero (`refundOrder` non deve piu' tagliarlo).
   */
  const chiedeRimborso = body.decision === 'APPROVED' && !!body.refundAmountCents;
  // R84 — Il tetto lo decide la stessa regola che usa chi muove i soldi: sui
  // contanti conta solo quello che e' stato incassato davvero.
  const COLONNE_ORDINE =
    'stripe_payment_intent, payment_method, gross_total_cents, total_price, refunded_amount_cents, wallet_applied_cents, cash_confirmed_at, payment_status, delivery_status';
  let ordine: OrdineDaRimborsare | null = null;

  if (chiedeRimborso) {
    const { data } = await conRipiegoSchema(
      'orders.select (decisione sul reso)',
      () => admin.from('orders').select(COLONNE_ORDINE).eq('id', ret.order_id).single(),
      () => admin.from('orders').select(senzaColonne(COLONNE_ORDINE, COLONNE_124)).eq('id', ret.order_id).single(),
    );
    ordine = (data ?? null) as OrdineDaRimborsare | null;
    if (!ordine) return ApiErrors.notFound('Ordine del reso non trovato');

    const rimborsabile = quantoSiPuoRestituire(ordine);
    if (rimborsabile.perche !== 'ok') {
      return ApiErrors.conflict(motivoNienteDaRestituire(rimborsabile.perche));
    }
    const residuoCent = rimborsabile.massimoCents;
    if (body.refundAmountCents! > residuoCent) {
      return ApiErrors.invalidRequest(
        `Il rimborso non può superare quello che resta dell ordine: al massimo ${(residuoCent / 100).toFixed(2)} €.`,
      );
    }
  }

  let refundId: string | null = null;
  let refundedAt: string | null = null;
  let newStatus: string = body.decision;
  /** R71 — quanto del rimborso va pagato col bonifico, a mano. */
  let bonificoCents = 0;

  /**
   * 21/8/2026 — PRIMA SI PRENDE IL TURNO, POI ESCONO I SOLDI.
   *
   * Qui il rimborso partiva PRIMA della guardia di stato, e il commento diceva
   * che tanto era «protetto dalla chiave di idempotenza di Stripe». Vero per il
   * denaro: Stripe rimborsa una volta sola. Falso per i conti nostri:
   * `accumula_rimborso` e' un incremento senza chiave, quindi due decisioni
   * partite insieme sullo stesso reso incrementavano DUE VOLTE
   * `refunded_amount_cents`. L'ordine risultava rimborsato per il doppio di
   * quello che era davvero uscito, il residuo che spettava al cliente diventava
   * irrimborsabile e il rendiconto del negozio sottraeva due volte la stessa
   * cifra.
   *
   * Adesso la rivendicazione dello stato viene prima: passa una decisione sola.
   * Se poi il rimborso fallisce, lo stato torna indietro (piu' sotto), cosi' il
   * reso resta decidibile invece di restare bloccato a meta'.
   */
  const statoRivendicato = body.decision === 'APPROVED' ? 'APPROVED' : body.decision;
  const { data: rivendicato, error: errRivendica } = await admin
    .from('returns')
    .update({
      status: statoRivendicato,
      decided_at: new Date().toISOString(),
      decided_by: user.id,
      decision_notes: body.notes ?? null,
      refund_amount_cents: body.refundAmountCents ?? null,
    })
    .eq('id', params.id)
    .eq('status', 'REQUESTED')
    .select('id');

  if (errRivendica) return ApiErrors.internal('Update fallito');
  if (!rivendicato || rivendicato.length === 0) {
    return ApiErrors.conflict("Reso già deciso da un'altra sessione");
  }

  /** Rimette il reso in attesa: si usa solo quando i soldi non sono usciti. */
  const rimettiInAttesa = async () => {
    await admin
      .from('returns')
      .update({ status: 'REQUESTED', decided_at: null, decided_by: null, refund_amount_cents: null })
      .eq('id', params.id)
      .eq('status', statoRivendicato);
  };

  if (chiedeRimborso) {
    const isCard = !!ordine?.stripe_payment_intent;
    const isCod = !isCard && ordine?.payment_method === 'cod';

    // Carta ma Stripe non configurato → NON marcare come rimborsato in silenzio.
    if (isCard && !isStripeConfigured()) {
      await rimettiInAttesa();
      return ApiErrors.unavailable('Stripe non configurato: impossibile emettere il rimborso ora.');
    }

    if (isCard || isCod) {
      // refundOrder gestisce il refund reale Stripe (carta + claw-back) e il
      // rimborso dei contanti. Idempotente via idempotencyKey return_<id>.
      //
      // R71 — Sui contanti il modo lo ha scelto il cliente nel modulo di reso:
      // credito MyCity solo se l'ha chiesto lui, altrimenti bonifico. Se la
      // scelta non si legge, vale bonifico (lib/rimborsi/scelta-del-reso.ts).
      const contanti = isCod ? comeTornanoIContanti(await leggiLaSceltaDelReso(admin, ret.id)) : undefined;
      try {
        const res = await refundOrder({
          orderId: ret.order_id,
          amountCents: body.refundAmountCents!,
          reason: body.notes ?? 'requested_by_customer',
          metadata: { return_id: ret.id },
          idempotencyKey: `return_${ret.id}`,
          notifyBuyer: true,
          ...(contanti ? { contanti } : {}),
        });
        refundId = res.refundId;
        refundedAt = new Date().toISOString();
        newStatus = 'REFUNDED';
        bonificoCents = res.bonificoCents ?? 0;
      } catch (err) {
        logger.error('[returns] refund failed', err);
        // I soldi non sono usciti: il reso torna decidibile invece di restare
        // fermo su «approvato» senza rimborso.
        await rimettiInAttesa();
        // Collaudo del 15/10, secondo giro (R82) — tranne una cosa, che il
        // negozio deve leggere com'e': un tentativo precedente ha GIA' dato al
        // cliente del credito, con una cifra diversa da questa. «Riprova» era
        // falso: riprovando con la cifra nuova si fermava di nuovo, e il
        // negozio non sapeva quale cifra rimettere. Gli altri errori restano
        // nascosti dietro la frase generica (R138: niente messaggi interni).
        if (err instanceof AccreditoGiaUscitoConAltroImporto) return ApiErrors.conflict(err.message);
        // 16/10 (terzo riesame) — e un rimborso che aspetta la divisione di un rimborso dal cruscotto
        // sullo stesso carrello: «riprova» da solo non cambia niente finché la divisione non è fatta.
        if (err instanceof RimborsoInAttesaDellaDivisione) return ApiErrors.conflict(err.message);
        return ApiErrors.badGateway("Il rimborso non è partito: riprova o scrivi all'assistenza.");
      }
    }
  }

  // Il turno era gia' stato preso sopra: qui si scrive solo l'esito del
  // rimborso. Se lo stato non e' cambiato (rifiuto, o approvazione senza
  // rimborso immediato) questa scrittura non tocca niente di nuovo.
  //
  // R71 — Se una parte va col bonifico, il reso ricorda quanto: e' la cifra che
  // la lista dei bonifici da fare mostra a chi paga. Senza la migrazione 162 la
  // colonna non c'e' e si scrive il resto (lib/db/migrazione-148.ts).
  if (newStatus !== statoRivendicato || refundId) {
    const scrittura = await scriviAncheSeMancaUnaColonnaNuova(
      'returns.update (esito del rimborso)',
      {
        status: newStatus,
        refund_id: refundId,
        refunded_at: refundedAt,
        ...(bonificoCents > 0 ? { refund_bonifico_cents: bonificoCents } : {}),
      },
      COLONNE_162,
      (campi) => admin.from('returns').update(campi).eq('id', params.id).eq('status', statoRivendicato),
    );
    if (scrittura.avviso) logger.warn(`[returns] ${scrittura.avviso}`);
    /**
     * Riesame del 16/10, terzo giro — QUI I SOLDI SONO GIA' PARTITI.
     *
     * Si arriva a questa scrittura solo dopo `refundOrder`: sull'ordine il
     * rimborso e' gia' registrato (sui contanti, il bonifico e' gia' dovuto).
     * Se cadeva, la rotta diceva solo «Update fallito»: il reso restava
     * «approvato» senza il segno del rimborso, il bonifico non entrava nella
     * lista di chi paga, e al negozio restava una sola strada — chiudere il
     * reso «senza rimborso», che cancella l'IBAN del cliente. Adesso fa come
     * `avanza`: chi amministra riceve l'avviso con reso, ordine e cifra del
     * bonifico, e il negozio legge che non deve ripetere il rimborso.
     */
    if (!scrittura.riuscita) {
      const avviso = avvisoDelRimborsoNonRegistrato({
        resoId: params.id, ordineId: ret.order_id, refundId, bonificoCents,
      });
      try {
        await notifyAdmins(avviso.titolo, avviso.testo, avviso.link);
      } catch (e) {
        logger.error('[returns] avviso del rimborso non registrato non inviato', { returnId: params.id, e });
      }
      return ApiErrors.internal(RIMBORSO_PARTITO_MA_NON_REGISTRATO);
    }
  }

  // Riesame del 16/10 — un reso respinto, o rimborsato senza un bonifico da
  // fare, non ha piu' bisogno dell'IBAN del cliente: se ne va. Se il bonifico
  // e' ancora da fare (o lo sara' a reso concluso) resta, fino al «fatto».
  if (newStatus === 'REJECTED' || newStatus === 'REFUNDED') {
    await dimenticaLIbanSeNonServe(admin, params.id);
  }

  // Notifica buyer
  await admin.from('notifications').insert({
    user_id: ret.buyer_id,
    title: body.decision === 'APPROVED' ? '✓ Reso approvato' : '✕ Reso rifiutato',
    body: body.notes ?? null,
    link: `/orders/${ret.order_id}`,
  });

  // Email di rimborso: già inviata da refundOrder (notifyBuyer: true).

  return NextResponse.json({ ok: true, status: newStatus, refundId }, { status: 200 });
}

// Rate limit: 30 decisioni / 10 min per seller (anti-abuse refund Stripe)
// 30/8/2026 (R017) — L'ADATTATORE A MANO NON C'E' PIU'.
//
// Qui c'era la riga che tutte le rotte dinamiche si riscrivevano: prendeva il
// secondo argomento di Next, ne aspettava la promessa e la riportava dentro
// l'involucro. Copiata tredici volte, e in ognuna bastava dimenticare l'`await`
// per far arrivare `undefined` alla query. Adesso i pezzi dell'indirizzo li
// risolve l'involucro, una volta sola, e arrivano gia' pronti nel contesto.
export const POST = withAuthRateLimit(
  { name: 'returns-decide', max: 30, windowMs: 10 * 60_000 },
  ({ req, user, params }) => handler(req, user, { id: String(params.id) }),
);
