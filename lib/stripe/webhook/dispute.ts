/**
 * Contestazioni carta (chargeback): apertura e chiusura.
 *
 * #12 — Perché sta qui e non in `app/api/stripe/webhook/route.ts`.
 *
 * Quel file era uno solo, da mille righe, con dentro otto mestieri senza
 * rapporto fra loro: creazione ordini, buoni regalo, spazi sponsorizzati,
 * abbonamenti, rimborsi, contestazioni, storni, esiti dei pagamenti. Ogni
 * modifica ai buoni regalo si portava dietro il rischio di toccare la
 * creazione degli ordini, perché stavano nello stesso file e la revisione
 * mostrava un diff dentro un blocco da mille righe. È la strada su cui
 * passano tutti i soldi del marketplace: è l'ultimo posto dove si vuole una
 * revisione difficile da leggere.
 *
 * Nessuna logica è cambiata in questo spostamento: le prove esistenti sul
 * webhook sono la dimostrazione che non si è rotto niente.
 */
import type Stripe from 'stripe';
import { reverseOrderTransfer, reverseRiderTransfer } from '@/lib/stripe/payout';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { conRipiegoSchema, senzaCampi } from '@/lib/db/migrazione-124';
import { findOrdersForDispute, notifyAdmins } from './comune';

/**
 * charge.dispute.created → chargeback aperto. Stripe ha GIÀ prelevato i fondi
 * dalla piattaforma, quindi NON emettiamo refund (sarebbe doppio): facciamo
 * solo claw-back del transfer se il venditore era già stato pagato, flagghiamo
 * gli ordini (dispute_status='OPEN' blocca il payout cron) e avvisiamo gli admin.
 */
export async function handleDisputeCreated(dispute: Stripe.Dispute) {
  const orders = await findOrdersForDispute(
    dispute,
    'id, payout_status, stripe_transfer_id, seller_payout_cents, seller_payout_reversed_cents, stripe_reversal_id, rider_id, rider_transfer_id, rider_payout_status, rider_payout_reversed_cents, rider_fee_cents, shipping_cost',
  );
  if (orders.length === 0) {
    logger.warn('[stripe] dispute.created: nessun ordine trovato', { disputeId: dispute.id });
    return;
  }

  for (const o of orders) {
    if (o.payout_status === 'TRANSFERRED') {
      try {
        await reverseOrderTransfer(o);
      } catch (e) {
        logger.error('[stripe] reversal on dispute.created failed', { orderId: o.id, e });
      }
    }
    // Anche il compenso del fattorino torna indietro: senza questo la
    // piattaforma restituisce l'incasso al cliente e paga la consegna da se'.
    try {
      await reverseRiderTransfer(o);
    } catch (e) {
      logger.error('[stripe] recupero compenso rider su contestazione fallito', { orderId: o.id, e });
    }
  }

  const admin = getAdminSupabase();
  await admin
    .from('orders')
    .update({ dispute_status: 'OPEN', disputed_at: new Date().toISOString() })
    .in('id', orders.map((o) => o.id));

  await notifyAdmins(
    '⚠️ Chargeback aperto',
    `Contestazione bancaria su ordine ${orders[0].id}${orders.length > 1 ? ` (+${orders.length - 1})` : ''} — ${((dispute.amount ?? 0) / 100).toFixed(2)}€.`,
    '/admin/disputes',
  );
}

/**
 * charge.dispute.closed → won: sblocca (gli ordini HELD tornano eleggibili al
 * payout cron). lost: i fondi sono già stati prelevati da Stripe (reversal già
 * fatto all'apertura) → annulla l'ordine (semantica rimborso).
 */
export async function handleDisputeClosed(dispute: Stripe.Dispute) {
  const orders = await findOrdersForDispute(dispute, 'id, payout_status, stripe_transfer_id, seller_payout_cents, seller_payout_reversed_cents, stripe_reversal_id, payout_tentativo, rider_id, rider_transfer_id, rider_payout_status, rider_payout_reversed_cents, rider_payout_tentativo, rider_fee_cents, shipping_cost');
  if (orders.length === 0) return;
  const admin = getAdminSupabase();
  const ids = orders.map((o) => o.id);

  if (dispute.status === 'won') {
    // Il payout va davvero sbloccato, non solo annunciato. All'apertura della
    // contestazione i soldi del venditore erano stati richiamati indietro
    // (payout_status='REVERSED'): se qui ci si limitasse a scrivere 'WON', il
    // venditore avrebbe consegnato la merce, vinto la causa e non essere mai
    // stato pagato — il cron dei payout non guarda gli ordini 'REVERSED'.
    await admin.from('orders').update({ dispute_status: 'WON' }).in('id', ids);

    const daRipagare = orders.filter((o) => o.payout_status === 'REVERSED');
    if (daRipagare.length > 0) {
      // 158 — Riga per riga, perche' il numero del tentativo sale di uno. E'
      // quel numero a rendere diversa la chiave di idempotenza del bonifico:
      // con la chiave vecchia Stripe avrebbe restituito il transfer gia'
      // stornato, e il venditore avrebbe vinto la causa senza essere pagato.
      for (const o of daRipagare) {
        const valori = {
          payout_status: 'HELD',       // torna fra i candidati del prossimo giro
          stripe_transfer_id: null,    // il transfer precedente e' stato stornato
          stripe_reversal_id: null,
          seller_payout_reversed_cents: 0,
          payout_at: null,
          payout_tentativo: ((o as { payout_tentativo?: number }).payout_tentativo ?? 0) + 1,
        };
        // Prima della migrazione 124 la colonna del tentativo non esiste e
        // l'aggiornamento fallirebbe intero: il venditore vincerebbe la
        // contestazione e resterebbe comunque a mani vuote. Rimetterlo in
        // coda senza quel numero e' meglio che non rimetterlo affatto.
        await conRipiegoSchema(
          'orders.update (contestazione vinta, venditore)',
          () => admin.from('orders').update(valori).eq('id', o.id),
          () => admin.from('orders').update(senzaCampi(valori, ['payout_tentativo'])).eq('id', o.id),
        );
      }
      logger.info('[stripe] contestazione vinta: payout rimessi in coda', {
        ordini: daRipagare.length,
      });
    }

    // 158 — E IL FATTORINO? All'apertura della contestazione gli veniva
    // richiamato indietro il compenso (`reverseRiderTransfer`, poche righe
    // sopra), ed e' il caso normale: il bonifico parte un'ora dopo la
    // consegna, la contestazione arriva settimane dopo. Poi qui si rimetteva
    // in coda solo il venditore. Il fattorino restava a 'REVERSED' per
    // sempre: la consegna l'aveva fatta, la piattaforma teneva l'incasso, e
    // lui non veniva pagato — senza nessun avviso. Su chi e' pagato a
    // consegna, questo e' abbandono alla seconda volta.
    const riderDaRipagare = orders.filter((o) => o.rider_payout_status === 'REVERSED' && o.rider_id);
    if (riderDaRipagare.length > 0) {
      for (const o of riderDaRipagare) {
        const valori = {
          rider_payout_status: 'HELD',
          rider_transfer_id: null,
          rider_payout_reversed_cents: 0,
          rider_payout_at: null,
          rider_payout_tentativo: ((o as { rider_payout_tentativo?: number }).rider_payout_tentativo ?? 0) + 1,
        };
        await conRipiegoSchema(
          'orders.update (contestazione vinta, fattorino)',
          () => admin.from('orders').update(valori).eq('id', o.id),
          () => admin.from('orders').update(senzaCampi(valori, ['rider_payout_tentativo'])).eq('id', o.id),
        );
      }
      logger.info('[stripe] contestazione vinta: compensi fattorino rimessi in coda', {
        ordini: riderDaRipagare.length,
      });
    }

    await notifyAdmins('✓ Chargeback vinto', `Contestazione vinta su ordine ${ids[0]}. Payout rimesso in coda.`, '/admin/disputes');
  } else if (dispute.status === 'lost') {
    await admin
      .from('orders')
      .update({
        dispute_status: 'LOST',
        delivery_status: 'CANCELED',
        payment_status: 'REFUNDED',
        canceled_at: new Date().toISOString(),
      })
      .in('id', ids);
    for (const id of ids) {
      await admin.rpc('restore_stock_for_order', { p_order_id: id });
    }
    await notifyAdmins('✕ Chargeback perso', `Contestazione persa su ordine ${ids[0]}. Ordine annullato.`, '/admin/disputes');
  } else {
    logger.info('[stripe] dispute.closed: stato non gestito', { status: dispute.status });
  }
}
