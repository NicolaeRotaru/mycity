/**
 * Storni di bonifico, bonifici bancari falliti, e stato del conto Connect
 * del venditore.
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
import { reverseOrderTransfer, applyConnectAccountStatus } from '@/lib/stripe/payout';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { notifyAdmins } from './comune';

/**
 * transfer.reversed → un transfer al seller/rider è stato revertito (claw-back o
 * azione Stripe). Sincronizza lo stato payout dell'ordine, così il DB non diverge
 * silenziosamente dalla realtà Stripe.
 */
export async function handleTransferReversed(transfer: Stripe.Transfer) {
  const admin = getAdminSupabase();

  // Stripe manda questo evento a OGNI storno, anche parziale. Marcare
  // 'REVERSED' senza guardare gli importi chiudeva la porta agli storni
  // successivi: reverseOrderTransfer parte solo da 'TRANSFERRED', quindi dopo un
  // rimborso parziale il resto non si poteva piu' recuperare.
  const stornato = transfer.amount_reversed ?? 0;
  const totale = transfer.amount ?? 0;
  const eTotale = totale > 0 ? stornato >= totale : true;

  if (!eTotale) {
    logger.info('[stripe] transfer.reversed parziale: stato invariato', {
      transferId: transfer.id, stornato, totale,
    });
    return;
  }

  await admin.from('orders').update({ payout_status: 'REVERSED' }).eq('stripe_transfer_id', transfer.id);
  await admin.from('orders').update({ rider_payout_status: 'REVERSED' }).eq('rider_transfer_id', transfer.id);
  logger.info('[stripe] transfer.reversed sincronizzato', { transferId: transfer.id });
}

export async function handleAccountUpdated(acct: Stripe.Account) {
  // Logica condivisa con POST /api/stripe/connect/refresh-status.
  await applyConnectAccountStatus(acct);
}

/** payout.failed → il bonifico bancario di un connected account è fallito: alert admin. */
export async function handlePayoutFailed(payout: Stripe.Payout) {
  await notifyAdmins(
    '⚠️ Payout bancario fallito',
    `Payout ${payout.id} fallito (${((payout.amount ?? 0) / 100).toFixed(2)}€): ${payout.failure_message ?? 'motivo sconosciuto'}.`,
    '/admin',
  );
  logger.warn('[stripe] payout.failed', { payoutId: payout.id, failure: payout.failure_message });
}
