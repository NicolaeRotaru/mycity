import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getServerSupabase, getAdminSupabase } from '@/lib/supabase/server';
import { isStripeConfigured } from '@/lib/stripe/client';
import { AccreditoGiaUscitoConAltroImporto, RimborsoInAttesaDellaDivisione, refundOrder } from '@/lib/stripe/payout';
import { logger } from '@/lib/logger';
import { withAuthRateLimit } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { CorpoTroppoGrande, jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { COLONNE_124, conRipiegoSchema, senzaColonne } from '@/lib/db/migrazione-124';
import { chiComandaIlReso } from '../../chi-comanda-il-reso';
import {
  motivoNienteDaRestituire,
  quantoSiPuoRestituire,
  type OrdineDaRimborsare,
} from '@/lib/rimborsi/regole-del-rimborso';
import { avvisoDelRimborsoNonRegistrato, RIMBORSO_PARTITO_MA_NON_REGISTRATO } from '@/lib/rimborsi/bonifici-da-fare';
import { bonificoDellaChiave } from '@/lib/stripe/elenco-dei-rimborsi';
import { notifyAdmins } from '@/lib/stripe/webhook/comune';

export const runtime = 'nodejs';

/**
 * UN RESO APPROVATO DEVE POTER ARRIVARE A FINE CORSA.
 *
 * 27/8/2026 (R042) — QUESTA ROTTA NON ESISTEVA, e il commento in cima a
 * `decide` la prometteva già: «transizione RECEIVED -> REFUNDED via altro
 * endpoint». Sotto `app/api/returns` c'erano due sole cartelle, `create` e
 * `[id]/decide`, e l'unica altra scrittura sulla tabella `returns` in tutto il
 * repository azzerava le note alla cancellazione di un account.
 *
 * La conseguenza non era di forma. Il giro dei bonifici esclude dai pagamenti
 * gli ordini con un reso in REQUESTED, APPROVED, SHIPPED_BACK o RECEIVED. Un
 * cliente apre un reso, il negozio lo approva e aspetta la merce indietro: da
 * quel momento il bonifico di quell'ordine è fermo PER SEMPRE, anche se il reso
 * poi non arriva o si chiude di persona. Il negozio vedeva «in attesa» senza
 * scadenza e telefonava; l'amministratore non aveva nessun comando per
 * sbloccare.
 *
 * Qui c'è quel comando. Le tappe sono quelle già dichiarate nello schema del
 * database (migrazione 024), e ognuna parte solo dallo stato giusto:
 *  · APPROVED    → SHIPPED_BACK  il cliente ha rispedito
 *  · SHIPPED_BACK/APPROVED → RECEIVED  la merce è tornata
 *  · RECEIVED    → REFUNDED      i soldi tornano al cliente (chiude il reso)
 *  · qualunque stato aperto → CANCELED  il reso si chiude senza rimborso
 *    (merce mai partita, accordo di persona, cliente che ci ripensa): è la
 *    voce che libera il bonifico, e prima non c'era.
 *
 * Chi può: il venditore del reso, o un amministratore.
 */
const Body = z.object({
  stato: z.enum(['SHIPPED_BACK', 'RECEIVED', 'REFUNDED', 'CANCELED']),
  note: z.string().max(1000).optional(),
  refundAmountCents: z.number().int().positive().optional(),
});

/** Da dove si può arrivare a ogni tappa. Fuori da qui non si passa. */
const PARTENZE_AMMESSE: Record<string, string[]> = {
  SHIPPED_BACK: ['APPROVED'],
  RECEIVED: ['APPROVED', 'SHIPPED_BACK'],
  REFUNDED: ['RECEIVED'],
  CANCELED: ['REQUESTED', 'APPROVED', 'SHIPPED_BACK', 'RECEIVED'],
};

async function handler(req: NextRequest, user: { id: string }, params: { id: string }): Promise<NextResponse> {
  let body;
  try {
    body = Body.parse(await jsonRichiesta(req, TETTO_JSON));
  } catch (e) {
  /**
   * 6/9/2026 — «TROPPO GRANDE» E «DATI NON VALIDI» NON SONO LA STESSA COSA.
   *
   * Il tetto sul corpo lancia un errore che porta con sé lo stato giusto (413).
   * Questo `catch` lo raccoglieva insieme a un JSON rotto e rispondeva 400
   * «Dati non validi»: chi manda troppa roba non capisce che deve solo mandarne
   * meno, e nei registri un limite superato non si distingue da un errore del
   * browser. Le rotte AI questa distinzione ce l'hanno da fine agosto (R153),
   * queste tre no.
   */
    if (e instanceof CorpoTroppoGrande) return ApiErrors.payloadTooLarge('La richiesta è troppo grande: scrivi una nota più corta.');
    return ApiErrors.invalidRequest('Dati non validi', e instanceof Error ? e.message : undefined);
  }

  const supa = await getServerSupabase();
  const { data: ret, error } = await supa
    .from('returns')
    .select('id, status, seller_id, buyer_id, order_id, refund_amount_cents, created_at, refund_id')
    .eq('id', params.id)
    .single();

  if (error || !ret) return ApiErrors.notFound('Reso non trovato');

  /**
   * 3/9/2026 — IL NEGOZIO LO DICE L'ORDINE, NON IL RESO.
   *
   * Qui c'era `if (ret.seller_id !== user.id)`: il permesso di rimborsare si
   * decideva leggendo una colonna della riga del reso, e quella riga il cliente
   * se la scriveva da solo. Bastava metterci il proprio identificativo per
   * essere «il negozio» e farsi restituire l'ordine intero tenendo la merce.
   * Il venditore vero e' quello dell'ordine, che il cliente non tocca.
   */
  const comando = await chiComandaIlReso(ret.order_id, user.id);
  if (!comando.autorizzato) {
    return comando.motivo === 'ordine-mancante'
      ? ApiErrors.notFound('Ordine del reso non trovato')
      : ApiErrors.forbidden();
  }

  // Un «rimborsato» rimasto a meta' si riprende (vedi `ripresa`, piu' sotto).
  const forseRipresa = body.stato === 'REFUNDED' && ret.status === 'REFUNDED' && !ret.refund_id;
  const partenze = PARTENZE_AMMESSE[body.stato];
  if (!forseRipresa && !partenze.includes(ret.status)) {
    return ApiErrors.conflict(`Un reso in ${ret.status} non può passare a ${body.stato}.`);
  }

  const admin = getAdminSupabase();

  // Il rimborso si controlla PRIMA di prendere il turno, come su `decide`: un
  // importo impossibile non deve lasciare traccia sul reso, e il venditore deve
  // leggere il motivo invece di un guasto tecnico.
  // R84 — Il tetto lo decide la stessa regola che usa chi muove i soldi: sui
  // contanti conta solo quello che e' stato incassato davvero.
  const COLONNE_ORDINE =
    'stripe_payment_intent, payment_method, gross_total_cents, total_price, refunded_amount_cents, wallet_applied_cents, cash_confirmed_at, payment_status, delivery_status, stripe_refund_id';
  let ordine: OrdineDaRimborsare | null = null;
  let importoRimborso = 0;
  /**
   * Riesame del 16/10, terzo giro — IL RIMBORSO E' GIA' PARTITO, MA IL RESO NON LO SA.
   *
   * Succede quando la scrittura dell'esito cade dopo il rimborso (in `decide`
   * o qui). Prima il reso restava li': «rimborsato» rispondeva «gia' rimborsato
   * per intero», e l'unica strada era «chiudi senza rimborso», che scriveva al
   * cliente «chiuso senza rimborso» mentre gli dovevamo il bonifico. Adesso, se
   * l'ordine porta gia' il rimborso di questo reso, «rimborsato» lo registra sul
   * reso senza rifarlo (nessun secondo bonifico), e «chiudi» non passa.
   *
   * Collaudo del 17/10, terzo giro — «rimborsato» lo registra passando da
   * `refundOrder`, che lo FINISCE: se il tentativo di prima e' morto dopo il segno,
   * l'avviso a chi paga e il credito non c'erano, e registrarlo e basta lasciava il
   * cliente senza soldi. Nessuna seconda prenotazione e nessun secondo bonifico.
   */
  let giaSullOrdine: { segno: string; centesimi: number } | null = null;

  if (body.stato === 'REFUNDED' || body.stato === 'CANCELED') {
    const { data, error: errOrdine } = await conRipiegoSchema(
      'orders.select (avanzamento del reso)',
      () => admin.from('orders').select(COLONNE_ORDINE).eq('id', ret.order_id).single(),
      () => admin.from('orders').select(senzaColonne(COLONNE_ORDINE, COLONNE_124)).eq('id', ret.order_id).single(),
    );
    ordine = (data ?? null) as OrdineDaRimborsare | null;
    if (!ordine) {
      return body.stato === 'CANCELED' && errOrdine
        ? ApiErrors.unavailable("Non riesco a controllare l'ordine del reso: riprova tra poco.")
        : ApiErrors.notFound('Ordine del reso non trovato');
    }
    giaSullOrdine = bonificoDellaChiave(ordine as { stripe_refund_id?: string | null }, `return_${ret.id}`);
  }

  /**
   * Collaudo del 17/10, terzo giro — «RIMBORSATO» RIMASTO A META' SI RIPRENDE.
   * Il turno scrive «rimborsato» prima dei soldi: se la funzione muore dentro il
   * rimborso, il reso resta «rimborsato» senza riferimento, e un secondo
   * «rimborsato» rispondeva 409 mentre il bonifico non l'aveva chiesto nessuno.
   * Se l'ordine porta il bonifico di questo reso, lo si finisce, senza un nuovo turno.
   */
  const ripresa = forseRipresa && !!giaSullOrdine;
  if (forseRipresa && !ripresa) {
    return ApiErrors.conflict(`Un reso in ${ret.status} non può passare a ${body.stato}.`);
  }

  if (body.stato === 'CANCELED' && giaSullOrdine) {
    return ApiErrors.conflict(
      'Il rimborso di questo reso è già partito: non si può chiudere «senza rimborso». ' +
        'Segna la merce come ricevuta e poi il reso come rimborsato: il rimborso non si ripete, si registra.',
    );
  }

  if (body.stato === 'REFUNDED' && giaSullOrdine) {
    // Il rimborso c'e' gia': si registra quello, con la cifra promessa all'approvazione.
    importoRimborso = Number(ret.refund_amount_cents ?? 0) > 0 ? Number(ret.refund_amount_cents) : giaSullOrdine.centesimi;
  } else if (body.stato === 'REFUNDED' && ordine) {
    const rimborsabile = quantoSiPuoRestituire(ordine);
    const residuoCent = rimborsabile.massimoCents;
    // Se non è indicato niente si rimborsa quello che il venditore aveva già
    // promesso quando ha approvato il reso.
    importoRimborso = body.refundAmountCents ?? Number(ret.refund_amount_cents ?? 0) ?? 0;
    if (importoRimborso <= 0) {
      return ApiErrors.invalidRequest('Indica quanto rimborsare al cliente.');
    }
    if (rimborsabile.perche !== 'ok') {
      return ApiErrors.conflict(motivoNienteDaRestituire(rimborsabile.perche));
    }
    if (importoRimborso > residuoCent) {
      return ApiErrors.invalidRequest(
        `Il rimborso non può superare quello che resta dell ordine: al massimo ${(residuoCent / 100).toFixed(2)} €.`,
      );
    }
    if (!!ordine.stripe_payment_intent && !isStripeConfigured()) {
      return ApiErrors.unavailable('Stripe non configurato: impossibile emettere il rimborso ora.');
    }
  }

  // Il turno si prende con la scrittura: due schede aperte sullo stesso reso
  // non possono farlo avanzare due volte.
  const statoPrecedente = ret.status;
  const { data: preso, error: errPresa } = ripresa
    ? { data: [{ id: ret.id }], error: null }
    : await admin
        .from('returns')
        .update({
          status: body.stato,
          decision_notes: body.note ?? null,
          ...(body.stato === 'REFUNDED' ? { refund_amount_cents: importoRimborso } : {}),
        })
        .eq('id', params.id)
        .eq('status', statoPrecedente)
        .select('id');

  if (errPresa) return ApiErrors.internal('Aggiornamento del reso fallito');
  if (!preso || preso.length === 0) {
    return ApiErrors.conflict("Il reso è già stato aggiornato da un'altra sessione");
  }

  let refundId: string | null = null;
  /** R71 — quanto del rimborso va pagato col bonifico, a mano. */
  let bonificoCents = 0;
  if (body.stato === 'REFUNDED') {
    // R71 — Sui contanti il rimborso va col bonifico, sempre (refundOrder). Se e'
    // gia' sull'ordine (vedi sopra) refundOrder non lo rifa': lo finisce.
    try {
      const res = await refundOrder({
        orderId: ret.order_id,
        amountCents: importoRimborso,
        reason: body.note ?? 'requested_by_customer',
        metadata: { return_id: ret.id },
        idempotencyKey: `return_${ret.id}`,
        notifyBuyer: true,
        resoChiestoIl: (ret as { created_at?: string | null }).created_at ?? null,
      });
      refundId = res.refundId;
      bonificoCents = res.bonificoCents ?? 0;
    } catch (err) {
      logger.error('[returns/avanza] rimborso fallito', err);
      // I soldi non sono usciti: il reso torna dov'era, così resta lavorabile
      // invece di restare fermo su «rimborsato» senza rimborso.
      await admin
        .from('returns')
        .update({ status: statoPrecedente })
        .eq('id', params.id)
        .eq('status', 'REFUNDED');
      // 17/10/2026 — Come `decide`: il negozio legge i due casi che deve
      // conoscere, e per tutto il resto una frase sola. Mai il testo grezzo
      // dell'errore (R138: niente messaggi interni).
      if (err instanceof AccreditoGiaUscitoConAltroImporto) return ApiErrors.conflict(err.message);
      if (err instanceof RimborsoInAttesaDellaDivisione) return ApiErrors.conflict(err.message);
      return ApiErrors.badGateway("Il rimborso non è partito: riprova o scrivi all'assistenza.");
    }
    const { error: updErr } = await admin
      .from('returns')
      .update({ refund_id: refundId, refunded_at: new Date().toISOString() })
      .eq('id', params.id);
    /**
     * Riesame del 16/10 — UNA SCRITTURA CADUTA NON E' UN «OK».
     *
     * I soldi sono gia' partiti (o il bonifico e' gia' registrato sull'ordine).
     * Il negozio leggeva «rimborsato» come se fosse tutto a posto. Qui si ferma,
     * e `decide` fa lo stesso (terzo giro del riesame): chi amministra riceve un
     * avviso con reso, ordine e cifra, e chi ha premuto legge che la
     * registrazione non e' riuscita.
     */
    if (updErr) {
      const avviso = avvisoDelRimborsoNonRegistrato({
        resoId: params.id, ordineId: ret.order_id, refundId, bonificoCents, resoGiaRimborsato: true,
      });
      try {
        await notifyAdmins(avviso.titolo, avviso.testo, avviso.link);
      } catch (e) {
        logger.error('[returns/avanza] avviso del rimborso non registrato non inviato', { returnId: params.id, e });
      }
      return ApiErrors.internal(RIMBORSO_PARTITO_MA_NON_REGISTRATO);
    }
  }

  const TITOLO: Record<string, string> = {
    SHIPPED_BACK: '📦 Reso: merce in viaggio',
    RECEIVED: '📥 Reso: merce ricevuta dal negozio',
    REFUNDED: '✓ Reso rimborsato',
    CANCELED: '✕ Reso chiuso senza rimborso',
  };
  await admin.from('notifications').insert({
    // #33 — la categoria decide se la persona vuole ancora ricevere questo
    // tipo di avviso: senza, gli interruttori non spegnevano niente.
    category: 'order',
    user_id: ret.buyer_id,
    title: TITOLO[body.stato],
    body: body.note ?? null,
    link: `/orders/${ret.order_id}`,
  });

  return NextResponse.json({ ok: true, status: body.stato, refundId }, { status: 200 });
}

// Stesso freno della decisione sul reso: tocca i soldi.
// 30/8/2026 (R017) — L'ADATTATORE A MANO NON C'E' PIU'.
//
// Qui c'era la riga che tutte le rotte dinamiche si riscrivevano: prendeva il
// secondo argomento di Next, ne aspettava la promessa e la riportava dentro
// l'involucro. Copiata tredici volte, e in ognuna bastava dimenticare l'`await`
// per far arrivare `undefined` alla query. Adesso i pezzi dell'indirizzo li
// risolve l'involucro, una volta sola, e arrivano gia' pronti nel contesto.
export const POST = withAuthRateLimit(
  { name: 'returns-avanza', max: 30, windowMs: 10 * 60_000 },
  ({ req, user, params }) => handler(req, user, { id: String(params.id) }),
);
