import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getStripe, isStripeConfigured } from '@/lib/stripe/client';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { withInternalAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';

export const runtime = 'nodejs';

const Body = z.object({
  orderId: z.string().uuid(),
});

/**
 * Rilascia il payout al seller per un ordine DELIVERED.
 *
 * Tipicamente chiamato da una cron job 7 giorni dopo la consegna
 * (per coprire il periodo di recesso 14gg al consumatore).
 * In MVP puo' essere chiamato manualmente da admin o dal trigger
 * "delivered" se non c'e' politica escrow.
 *
 * SOLO server-to-server. Verifica la chiave x-internal-secret.
 */
export const POST = withInternalAuth(async (req): Promise<NextResponse> => {
  if (!isStripeConfigured()) return ApiErrors.unavailable('Stripe non configurato');

  let body;
  try {
    body = Body.parse(await req.json());
  } catch (e: any) {
    return ApiErrors.invalidRequest('Bad request', e?.message);
  }

  const admin = getAdminSupabase();
  const { data: order, error } = await admin
    .from('orders')
    .select('id, seller_id, payout_status, seller_payout_cents, stripe_payment_intent, delivery_status')
    .eq('id', body.orderId)
    .single();

  if (error || !order) return ApiErrors.notFound('Ordine non trovato');
  if (order.delivery_status !== 'DELIVERED') {
    return ApiErrors.conflict('Ordine non ancora consegnato');
  }
  if (order.payout_status !== 'HELD') {
    return ApiErrors.conflict(`Payout in stato ${order.payout_status}, no-op`);
  }
  if (!order.seller_payout_cents || order.seller_payout_cents <= 0) {
    return ApiErrors.invalidRequest('Importo payout non valido');
  }

  const { data: seller } = await admin
    .from('profiles')
    .select('stripe_account_id, stripe_payouts_enabled')
    .eq('id', order.seller_id)
    .single();

  if (!seller?.stripe_account_id || !seller.stripe_payouts_enabled) {
    return ApiErrors.conflict("Seller non ha completato l'onboarding Stripe Connect");
  }

  try {
    const stripe = getStripe();
    const transfer = await stripe.transfers.create({
      amount: order.seller_payout_cents,
      currency: 'eur',
      destination: seller.stripe_account_id,
      transfer_group: `order_${order.id}`,
      metadata: {
        order_id: order.id,
        seller_id: order.seller_id,
      },
    });

    await admin
      .from('orders')
      .update({
        stripe_transfer_id: transfer.id,
        payout_status: 'TRANSFERRED',
        payout_at: new Date().toISOString(),
      })
      .eq('id', order.id);

    return NextResponse.json({ ok: true, transferId: transfer.id }, { status: 200 });
  } catch (err: any) {
    logger.error('[stripe] transfer failed', err);
    await admin
      .from('orders')
      .update({ payout_status: 'FAILED' })
      .eq('id', order.id);
    return ApiErrors.internal('Transfer failed');
  }
});
