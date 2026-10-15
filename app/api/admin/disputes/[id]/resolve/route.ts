import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getAdminSupabase } from '@/lib/supabase/server';
import { isStripeConfigured } from '@/lib/stripe/client';
import { refundOrder } from '@/lib/stripe/payout';
import { logger } from '@/lib/logger';
import { withAdminAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { writeAudit } from '@/lib/audit';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { COLONNE_124, conRipiegoSchema, senzaColonne } from '@/lib/db/migrazione-124';
import {
  motivoNienteDaRestituire,
  quantoSiPuoRestituire,
  statoDelReclamoSullOrdine,
  type OrdineDaRimborsare,
} from '@/lib/rimborsi/regole-del-rimborso';

export const runtime = 'nodejs';

const Body = z.object({
  status: z.enum(['resolved_buyer', 'resolved_seller', 'rejected']),
  notes: z.string().min(10).max(1000),
  refundCents: z.number().int().positive().optional(),
});

/**
 * Admin risolve una dispute interna (reclamo buyer↔seller).
 *
 * Su 'resolved_buyer' + refundCents → emette un rimborso REALE (refundOrder:
 * refund Stripe + claw-back del transfer se il venditore era già stato pagato;
 * sugli ordini in contanti un bonifico da fare a mano, e credito MyCity solo
 * per la parte pagata col credito — R71). L'importo non può superare quello
 * che il cliente ha davvero pagato (R84). 'resolved_buyer' senza importo =
 * risoluzione DB-only valida.
 * 'resolved_seller'/'rejected' = solo aggiornamento DB.
 *
 * NB: usa getAdminSupabase() (service role). La tabella disputes non ha policy
 * RLS UPDATE per il ruolo authenticated, quindi l'update DEVE passare da qui
 * server-side (l'update client-side falliva silenziosamente su 0 righe).
 */
async function handler(req: NextRequest, user: { id: string }, params: { id: string }): Promise<NextResponse> {
  let body;
  try {
    body = Body.parse(await jsonRichiesta(req, TETTO_JSON));
  } catch (e) {
    return ApiErrors.invalidRequest('Dati non validi', e instanceof Error ? e.message : undefined);
  }

  const admin = getAdminSupabase();
  const { data: dispute, error } = await admin
    .from('disputes')
    .select('id, status, order_id, opener_id, against_id')
    .eq('id', params.id)
    .single();

  if (error || !dispute) return ApiErrors.notFound('Reclamo non trovato');
  if (dispute.status !== 'open' && dispute.status !== 'under_review') {
    return ApiErrors.conflict(`Reclamo già in stato ${dispute.status}`);
  }

  let refundId: string | null = null;

  // L'ordine si legge una volta sola, PRIMA di prendere il turno: serve a
  // sapere se e' una carta, quanto si puo' davvero restituire, e — dopo — se il
  // rimborso ha coperto tutto.
  //
  // R84 — Il pannello dei reclami non mostra se un ordine in contanti e' stato
  // incassato: c'e' solo un campo libero «Rimborso (€)». Un ordine mai pagato,
  // chiuso a favore del cliente con 24 € scritti li', diventava 24 € di credito
  // dal nulla. Il controllo sta qui, prima del turno, con la stessa regola che
  // usa chi muove i soldi (lib/rimborsi/regole-del-rimborso.ts): un importo
  // impossibile non lascia traccia sul reclamo, e chi decide legge il perche'.
  const COLONNE_ORDINE =
    'stripe_payment_intent, payment_method, total_price, gross_total_cents, wallet_applied_cents, refunded_amount_cents, cash_confirmed_at, payment_status, delivery_status';
  let ord: OrdineDaRimborsare | null = null;
  if (dispute.order_id) {
    const { data } = await conRipiegoSchema(
      'orders.select (risoluzione del reclamo)',
      () => admin.from('orders').select(COLONNE_ORDINE).eq('id', dispute.order_id).single(),
      () => admin.from('orders').select(senzaColonne(COLONNE_ORDINE, COLONNE_124)).eq('id', dispute.order_id).single(),
    );
    ord = (data ?? null) as OrdineDaRimborsare | null;
  }

  if (body.status === 'resolved_buyer' && body.refundCents && ord) {
    const rimborsabile = quantoSiPuoRestituire(ord);
    if (rimborsabile.perche !== 'ok') {
      return ApiErrors.conflict(motivoNienteDaRestituire(rimborsabile.perche));
    }
    if (body.refundCents > rimborsabile.massimoCents) {
      return ApiErrors.invalidRequest(
        `Il rimborso non può superare quello che il cliente ha pagato e non ha ancora riavuto: al massimo ${(rimborsabile.massimoCents / 100).toFixed(2)} €.`,
      );
    }
  }

  /**
   * 21/8/2026 — PRIMA SI PRENDE IL TURNO, POI ESCONO I SOLDI.
   *
   * La guardia di stato stava DOPO il rimborso, e il commento diceva che tanto
   * c'era la chiave di idempotenza di Stripe. Quella protegge il denaro, non i
   * conti: `accumula_rimborso` e' un incremento senza chiave, quindi due
   * risoluzioni partite insieme sullo stesso reclamo alzavano DUE VOLTE
   * `refunded_amount_cents` mentre Stripe rimborsava una volta sola.
   *
   * Ora si rivendica prima. Se il rimborso poi fallisce, il reclamo torna
   * aperto: e' l'unico modo perche' resti risolvibile.
   */
  const statiRisolvibili = ['open', 'under_review'];
  const { data: rivendicato, error: errRivendica } = await admin
    .from('disputes')
    .update({
      status: body.status,
      resolution_notes: body.notes,
      resolved_by: user.id,
      resolved_at: new Date().toISOString(),
      refund_cents: body.refundCents ?? null,
    })
    .eq('id', params.id)
    .in('status', statiRisolvibili)
    .select('id');

  if (errRivendica) return ApiErrors.internal('Update fallito');
  if (!rivendicato || rivendicato.length === 0) {
    return ApiErrors.conflict("Reclamo già risolto da un'altra sessione");
  }

  /** Riapre il reclamo: si usa solo quando i soldi NON sono usciti. */
  const riapri = async () => {
    await admin
      .from('disputes')
      .update({ status: dispute.status, resolved_by: null, resolved_at: null, refund_cents: null })
      .eq('id', params.id)
      .eq('status', body.status);
  };

  /** Vero solo se i soldi sono davvero usciti verso il cliente. */
  let rimborsoEmesso = false;
  /** R76 — il verdetto di `refundOrder`: il cliente ha riavuto l'intero lordo. */
  let rimborsoPieno = false;

  // Rimborso reale solo se risolto a favore del buyer con un importo.
  if (body.status === 'resolved_buyer' && body.refundCents) {
    // refundOrder gestisce sia il refund Stripe (carta + claw-back) sia
    // l'accredito sul wallet (COD, 🟠-18). Il blocco su Stripe-non-configurato
    // vale SOLO per gli ordini carta: un rimborso COD non usa Stripe.
    const isCard = !!ord?.stripe_payment_intent;
    if (isCard && !isStripeConfigured()) {
      await riapri();
      return ApiErrors.unavailable('Stripe non configurato');
    }
    try {
      const res = await refundOrder({
        orderId: dispute.order_id,
        amountCents: body.refundCents,
        reason: body.notes,
        metadata: { dispute_id: dispute.id },
        idempotencyKey: `dispute_${dispute.id}`,
        notifyBuyer: true,
        // R71 — Un reclamo su un ordine in contanti si rimborsa col bonifico: il
        // credito MyCity arriva solo se il cliente l'ha scelto, e qui non l'ha
        // scelto nessuno. L'avviso del bonifico da fare porta ai reclami, dove
        // chi l'ha deciso ritrova il caso.
        contanti: { modo: 'BONIFICO', doveSiPaga: '/admin/disputes' },
      });
      refundId = res.refundId;
      rimborsoEmesso = true;
      rimborsoPieno = res.pieno;
    } catch (err) {
      logger.error('[disputes] refund failed', err);
      await riapri();
      return ApiErrors.badGateway('Rimborso fallito: ' + (err instanceof Error ? err.message : 'unknown'));
    }
  }

  // Sbloccare il payout del venditore.
  //
  // All'apertura del reclamo un trigger scrive `orders.dispute_status='OPEN'`, e
  // il cron dei payout paga solo gli ordini con quel campo vuoto o 'WON'.
  // Chiudere il reclamo aggiornava soltanto la tabella dei reclami: il campo
  // sull'ordine restava 'OPEN' per sempre, e il venditore non veniva pagato mai
  // piu'. Non c'era nessun punto nel codice che lo riportasse indietro.
  if (dispute.order_id) {
    // 050 / 173 — Questa rotta scriveva `orders.dispute_status`, che è la
    // colonna del CHARGEBACK BANCARIO e appartiene solo al webhook di Stripe.
    // Due conseguenze, tutte e due vere:
    //  · chiudere un reclamo interno a favore del negozio azzerava il flag di
    //    una contestazione ancora aperta in banca, e il cron pagava il negozio
    //    con i soldi che la banca aveva già ripreso;
    //  · chiuderlo a favore del cliente scriveva 'LOST' anche senza nessun
    //    chargeback, e quel pagamento restava bloccato per sempre.
    // Il reclamo interno ora ha la sua colonna. La banca la sua.
    //
    // 27/8/2026 (R041 · R122) — «A FAVORE DEL CLIENTE» NON VUOL DIRE «IL
    // NEGOZIO NON VA PAGATO». Qui si scriveva 'LOST' su qualunque esito a
    // favore del cliente, senza guardare se un rimborso fosse davvero uscito e
    // per quanto. Ma il campo importo e' facoltativo, e la risoluzione senza
    // rimborso e' il caso normale quando il negozio rimedia in natura,
    // riconsegna o sostituisce. Il giro dei bonifici accetta solo vuoto o
    // 'RESOLVED', nessun percorso riporta mai indietro 'LOST' e il reclamo non
    // si puo' riaprire: quel negozio non veniva pagato mai piu', in silenzio,
    // e se ne accorgeva al controllo del mese.
    //
    // 'LOST' resta quindi solo per il caso che lo merita: il cliente e' stato
    // rimborsato dell'INTERO ordine, quindi al negozio non spetta piu' niente.
    // Su un rimborso parziale il residuo (gia' ridotto da
    // `seller_payout_reversed_cents`) riparte al giro successivo.
    //
    // R76 (11/10/2026) — «INTERO» LO DICE CHI HA MOSSO I SOLDI. Qui si
    // ricalcolava su `total_price`, che e' la cassa DOPO il credito MyCity,
    // mentre `refundOrder` misura sul lordo. Ordine da 50 €: 20 di credito e 30
    // in contanti. Rimborso dei 30 € di contanti: per i soldi era parziale (al
    // negozio restavano 18 €), per questa riga integrale — e 'LOST' toglieva
    // l'ordine dai bonifici per sempre. Ora si usa il verdetto di `refundOrder`.
    const statoSullOrdine = statoDelReclamoSullOrdine({ rimborsoEmesso, rimborsoPieno });
    const { error: errOrdine } = await admin
      .from('orders')
      .update({ internal_dispute_status: statoSullOrdine })
      .eq('id', dispute.order_id);
    if (errOrdine) {
      // Non blocca la risoluzione, ma deve essere visibile: il venditore resta
      // in attesa di essere pagato.
      logger.error('[dispute] stato dell ordine non sbloccato', {
        orderId: dispute.order_id, message: errOrdine.message,
      });
    }
  }

  // Notifica chi ha aperto il reclamo.
  await admin.from('notifications').insert({
        // #33 — la categoria decide se la persona vuole ancora ricevere
        // questo tipo di avviso: senza, gli interruttori non spegnevano niente.
        category: 'order',
    user_id: dispute.opener_id,
    title:
      body.status === 'resolved_buyer'
        ? '✓ Reclamo risolto a tuo favore'
        : body.status === 'resolved_seller'
          ? 'Reclamo risolto a favore del venditore'
          : '✕ Reclamo respinto',
    body: body.notes,
    link: `/orders/${dispute.order_id}`,
  });

  await writeAudit({
    actorId: user.id,
    action:
      body.status === 'resolved_buyer'
        ? 'dispute.resolve_buyer'
        : body.status === 'resolved_seller'
          ? 'dispute.resolve_seller'
          : 'dispute.reject',
    targetTable: 'disputes',
    targetId: dispute.id,
    metadata: { orderId: dispute.order_id, refundCents: body.refundCents ?? null, refundId, notes: body.notes },
  });

  return NextResponse.json({ ok: true, status: body.status, refundId }, { status: 200 });
}

// Rate limit ereditato da withAdminAuth (solo admin). Params Next 14 sync.
// 30/8/2026 (R017) — L'ADATTATORE A MANO NON C'E' PIU'.
//
// Qui c'era la riga che tutte le rotte dinamiche si riscrivevano: prendeva il
// secondo argomento di Next, ne aspettava la promessa e la riportava dentro
// l'involucro. Copiata tredici volte, e in ognuna bastava dimenticare l'`await`
// per far arrivare `undefined` alla query. Adesso i pezzi dell'indirizzo li
// risolve l'involucro, una volta sola, e arrivano gia' pronti nel contesto.
export const POST = withAdminAuth(({ req, user, params }) => handler(req, user, { id: String(params.id) }));
