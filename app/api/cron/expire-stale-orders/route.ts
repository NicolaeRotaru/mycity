import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withCronAuth } from '@/lib/api/middleware';
import { refundOrder } from '@/lib/stripe/payout';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

/**
 * Cron: chiude gli ordini ORFANI fermi in NEW che il venditore non ha mai
 * accettato (es. ordine piazzato di notte). Senza questo restano in limbo a
 * tempo indefinito: nessuno stato di prodotto, stock bloccato, buyer all'oscuro.
 *
 * Policy (audit 🟠-16): oltre STALE_NEW_ORDER_HOURS in NEW →
 *  - claim atomico NEW → CANCELED (idempotente: nessun doppio annullo/rimborso);
 *  - card pagato: rimborso reale via refundOrder (Stripe refund + ripristino
 *    stock + email buyer; reversal no-op perché il payout è ancora HELD);
 *  - COD / non pagato: ripristino stock (restore_stock_for_order);
 *  - storno dell'eventuale credito wallet speso (wallet_credit);
 *  - notifica in-app al buyer.
 *
 * Idempotente: la transizione di stato condizionata fa sì che ogni ordine sia
 * processato una sola volta anche se il cron si sovrappone.
 *
 * Setup esterno (cron-job.org): POST autenticato ogni ~30 min
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *     https://yourapp.com/api/cron/expire-stale-orders
 */

/** Ore in NEW oltre le quali un ordine non accettato viene annullato. */
const STALE_NEW_ORDER_HOURS = 3;

export const POST = withCronAuth(async (): Promise<NextResponse> => {
  const admin = getAdminSupabase();
  const cutoff = new Date(Date.now() - STALE_NEW_ORDER_HOURS * 3_600_000).toISOString();

  const { data: candidates, error } = await admin
    .from('orders')
    .select('id, user_id, payment_method, payment_status, stripe_payment_intent, total_price, wallet_applied_cents')
    .eq('delivery_status', 'NEW')
    .lt('created_at', cutoff)
    .limit(100);

  if (error) {
    logger.error('[cron] expire-stale-orders: select fallita', error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  let canceled = 0;
  let refunded = 0;
  let failed = 0;

  for (const o of candidates ?? []) {
    // Claim atomico: solo il primo passaggio porta NEW → CANCELED. Se un'altra
    // esecuzione ha già preso l'ordine, 0 righe → skip (no doppio rimborso).
    const { data: claimed, error: claimErr } = await admin
      .from('orders')
      .update({ delivery_status: 'CANCELED', canceled_at: new Date().toISOString() })
      .eq('id', o.id)
      .eq('delivery_status', 'NEW')
      .select('id');
    if (claimErr) {
      failed++;
      logger.error('[cron] expire-stale-orders: claim fallito', { id: o.id, message: claimErr.message });
      continue;
    }
    if (!claimed || claimed.length === 0) continue;

    try {
      const isCardPaid =
        o.payment_method === 'card' && o.payment_status === 'PAID' && !!o.stripe_payment_intent;

      if (isCardPaid) {
        // refundOrder fa: refund Stripe (idempotente) + reversal (no-op, HELD) +
        // ripristino stock + email buyer + stato REFUNDED/CANCELED.
        await refundOrder({
          orderId: o.id,
          amountCents: Math.round(Number(o.total_price) * 100),
          reason: 'Ordine annullato: il venditore non lo ha accettato in tempo',
          notifyBuyer: true,
        });
        refunded++;
      } else {
        // COD / non pagato: nessun addebito da rimborsare, solo ripristino stock.
        const { error: rErr } = await admin.rpc('restore_stock_for_order', { p_order_id: o.id });
        if (rErr) logger.warn('[cron] expire-stale-orders: restore_stock fallito', { id: o.id, message: rErr.message });
      }

      // Storno del credito wallet eventualmente speso (entrambi i percorsi).
      const walletCents = Number(o.wallet_applied_cents ?? 0);
      if (walletCents > 0) {
        const { error: wErr } = await admin.rpc('wallet_credit', {
          p_user: o.user_id,
          p_cents: walletCents,
          p_reason: 'order_auto_canceled',
          p_ref: o.id,
        });
        if (wErr) logger.warn('[cron] expire-stale-orders: storno wallet fallito', { id: o.id, message: wErr.message });
      }

      // Notifica in-app al buyer (best-effort: non deve far fallire l'annullo).
      await admin.from('notifications').insert({
        user_id: o.user_id,
        title: 'Ordine annullato',
        body: `L'ordine #${o.id.slice(0, 6).toUpperCase()} è stato annullato: il negozio non lo ha accettato in tempo.${isCardPaid ? ' Il rimborso è in corso.' : ''}`,
        link: '/orders',
      });

      canceled++;
    } catch (e) {
      failed++;
      logger.error('[cron] expire-stale-orders: annullo fallito', {
        id: o.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (canceled > 0 || failed > 0) {
    logger.info(`[cron] expire-stale-orders: ${canceled} annullati (${refunded} rimborsati), ${failed} falliti`);
  }

  return NextResponse.json({ ok: true, canceled, refunded, failed }, { status: 200 });
});
