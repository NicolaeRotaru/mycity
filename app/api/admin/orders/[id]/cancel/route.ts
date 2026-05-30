import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getAdminSupabase } from '@/lib/supabase/server';
import { isStripeConfigured } from '@/lib/stripe/client';
import { refundOrder } from '@/lib/stripe/payout';
import { logger } from '@/lib/logger';
import { withAdminAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';

export const runtime = 'nodejs';

const Body = z.object({
  reason: z.string().max(500).optional(),
});

/**
 * Admin annulla un ordine.
 *  - Ordine carta GIÀ PAGATO → rimborso Stripe REALE + claw-back del transfer
 *    (refundOrder, che imposta anche delivery_status='CANCELED').
 *  - Ordine COD / non pagato → solo CANCELED (niente Stripe).
 * Rifiuta ordini già CANCELED. Notifica il buyer in campanella.
 */
async function handler(req: NextRequest, user: { id: string }, params: { id: string }): Promise<NextResponse> {
  let body;
  try {
    body = Body.parse(await req.json().catch(() => ({})));
  } catch (e) {
    return ApiErrors.invalidRequest('Dati non validi', e instanceof Error ? e.message : undefined);
  }

  const admin = getAdminSupabase();
  const { data: order, error } = await admin
    .from('orders')
    .select('id, user_id, total_price, payment_method, payment_status, delivery_status, stripe_payment_intent')
    .eq('id', params.id)
    .single();
  if (error || !order) return ApiErrors.notFound('Ordine non trovato');
  if (order.delivery_status === 'CANCELED') return ApiErrors.conflict('Ordine già annullato');

  const reason = body.reason?.trim() || 'Ordine annullato dall’amministrazione';
  let refundId: string | null = null;

  const isPaidCard =
    order.payment_method === 'card' && !!order.stripe_payment_intent && order.payment_status === 'PAID';

  if (isPaidCard) {
    if (!isStripeConfigured()) return ApiErrors.unavailable('Stripe non configurato');
    try {
      const res = await refundOrder({
        orderId: order.id,
        amountCents: Math.round(Number(order.total_price) * 100),
        reason,
        metadata: { canceled_by: user.id, source: 'admin_cancel' },
        notifyBuyer: true,
      });
      refundId = res.refundId;
    } catch (err) {
      logger.error('[admin cancel] refund failed', err);
      return ApiErrors.badGateway('Rimborso Stripe fallito: ' + (err instanceof Error ? err.message : 'unknown'));
    }
    // refundOrder ha già impostato CANCELED + canceled_at + payment_status.
  } else {
    const { error: updErr } = await admin
      .from('orders')
      .update({
        delivery_status: 'CANCELED',
        canceled_at: new Date().toISOString(),
        ...(order.payment_status === 'PENDING' ? { payment_status: 'FAILED' } : {}),
      })
      .eq('id', order.id);
    if (updErr) return ApiErrors.internal('Annullamento fallito');
  }

  // Notifica in-app al buyer.
  await admin.from('notifications').insert({
    user_id: order.user_id,
    title: '✕ Ordine annullato',
    body: refundId ? `${reason} · rimborso emesso` : reason,
    link: `/orders/${order.id}`,
  });

  return NextResponse.json({ ok: true, refundId }, { status: 200 });
}

export const POST = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
  withAdminAuth(async ({ user }) => handler(req, user, await ctx.params))(req);
