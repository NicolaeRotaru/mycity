import type { SupabaseClient } from '@supabase/supabase-js';
import { refundOrder } from '@/lib/stripe/payout';
import { isStripeConfigured } from '@/lib/stripe/client';
import { logger } from '@/lib/logger';

/**
 * ANNULLARE UN ORDINE VUOL DIRE ANCHE RESTITUIRE I SOLDI.
 *
 * Difetto bloccante trovato dalla radiografia del 21/8/2026. L'annullamento del
 * cliente e il rifiuto del negozio passavano da due funzioni del database
 * (`cancel_order`, `seller_reject_order`) che facevano due cose sole: mettere
 * l'ordine in CANCELED e rimettere la merce a magazzino. Del denaro non si
 * occupava nessuno.
 *
 * Un ordine pagato con carta finiva annullato con i soldi ancora da noi. Il
 * cliente leggeva «Niente addebiti» e sull'estratto conto l'addebito c'era.
 * Nessun processo li restituiva: restavano finché qualcuno non se ne accorgeva
 * a mano. Stessa cosa per il credito MyCity speso sull'ordine.
 *
 * La logica giusta esisteva già, ma in un posto solo: la rotta di annullamento
 * dell'amministrazione. Era una copia unica dentro un percorso che il cliente
 * non attraversa mai. Ora sta qui, e la usano tutti e tre.
 */

export type EsitoAnnullo =
  | { ok: true; refundId: string | null }
  | { ok: false; motivo: 'CONTANTI_INCASSATI' | 'STRIPE_NON_CONFIGURATO' | 'RIMBORSO_FALLITO' | 'ANNULLAMENTO_FALLITO'; dettaglio?: string };

/** I campi che servono per decidere cosa fare dei soldi. */
export const COLONNE_ANNULLO =
  'id, user_id, seller_id, total_price, payment_method, payment_status, delivery_status, ' +
  'stripe_payment_intent, wallet_applied_cents, cash_confirmed_at, refunded_amount_cents';

export type OrdineDaAnnullare = {
  id: string;
  user_id: string;
  seller_id?: string | null;
  total_price: number | string;
  payment_method: string | null;
  payment_status: string | null;
  delivery_status: string | null;
  stripe_payment_intent: string | null;
  wallet_applied_cents?: number | null;
  cash_confirmed_at?: string | null;
  refunded_amount_cents?: number | null;
};

/**
 * Porta l'ordine ad annullato e rimette a posto il denaro: rimborso sulla carta
 * se era pagato, credito MyCity restituito se ne era stato usato, merce a
 * magazzino. NON decide CHI può annullare: quello resta a chi la chiama.
 */
export async function annullaERimborsa(
  admin: SupabaseClient,
  order: OrdineDaAnnullare,
  opts: { reason: string; metadata?: Record<string, string>; motivoCredito?: string },
): Promise<EsitoAnnullo> {
  // 053 — Un ordine già rimborsato in parte ha stato 'PARTIALLY_REFUNDED':
  // trattarlo come «niente da rimborsare» lasciava indietro il residuo, cioè la
  // parte di soldi che il cliente non aveva mai riavuto.
  const isPaidCard =
    order.payment_method === 'card' &&
    !!order.stripe_payment_intent &&
    (order.payment_status === 'PAID' || order.payment_status === 'PARTIALLY_REFUNDED');

  // Contanti già incassati dal fattorino: la restituzione è un fatto fisico e la
  // decide una persona. Annullare in silenzio lascerebbe il cliente senza merce
  // e senza soldi.
  if (order.payment_method === 'cod' && !!order.cash_confirmed_at) {
    return { ok: false, motivo: 'CONTANTI_INCASSATI' };
  }

  if (isPaidCard) {
    if (!isStripeConfigured()) return { ok: false, motivo: 'STRIPE_NON_CONFIGURATO' };
    try {
      const totaleCent = Math.round(Number(order.total_price) * 100);
      const giaRimborsato = Number(order.refunded_amount_cents ?? 0);
      const residuoCent = Math.max(0, totaleCent - giaRimborsato);
      const res = await refundOrder({
        orderId: order.id,
        amountCents: residuoCent,
        reason: opts.reason,
        metadata: opts.metadata,
        notifyBuyer: true,
      });
      // refundOrder ha già impostato CANCELED + canceled_at + payment_status.
      return { ok: true, refundId: res.refundId };
    } catch (err) {
      logger.error('[annullaERimborsa] rimborso fallito', { orderId: order.id, err });
      return { ok: false, motivo: 'RIMBORSO_FALLITO', dettaglio: err instanceof Error ? err.message : undefined };
    }
  }

  const { error: updErr } = await admin
    .from('orders')
    .update({
      delivery_status: 'CANCELED',
      canceled_at: new Date().toISOString(),
      ...(order.payment_status === 'PENDING' ? { payment_status: 'FAILED' } : {}),
    })
    .eq('id', order.id);
  if (updErr) return { ok: false, motivo: 'ANNULLAMENTO_FALLITO', dettaglio: updErr.message };

  await admin.rpc('restore_stock_for_order', { p_order_id: order.id });

  // Il credito MyCity speso sull'ordine torna al cliente: senza, l'annullamento
  // gli costa comunque quei soldi.
  const walletCents = Number(order.wallet_applied_cents ?? 0);
  if (walletCents > 0) {
    const { error: wErr } = await admin.rpc('wallet_credit', {
      p_user: order.user_id,
      p_cents: walletCents,
      p_reason: opts.motivoCredito ?? 'order_canceled',
      p_ref: order.id,
    });
    if (wErr) logger.warn('[annullaERimborsa] storno credito fallito', { orderId: order.id, err: wErr.message });
  }

  return { ok: true, refundId: null };
}
