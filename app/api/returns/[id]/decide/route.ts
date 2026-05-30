import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getServerSupabase, getAdminSupabase } from '@/lib/supabase/server';
import { isStripeConfigured } from '@/lib/stripe/client';
import { refundOrder } from '@/lib/stripe/payout';
import { logger } from '@/lib/logger';
import { withAuthRateLimit } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';

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
    body = Body.parse(await req.json());
  } catch (e) {
    return ApiErrors.invalidRequest('Dati non validi', e instanceof Error ? e.message : undefined);
  }

  const supa = await getServerSupabase();
  const { data: ret, error } = await supa
    .from('returns')
    .select('id, status, seller_id, buyer_id, order_id, refund_amount_cents')
    .eq('id', params.id)
    .single();

  if (error || !ret) return ApiErrors.notFound('Reso non trovato');
  if (ret.seller_id !== user.id) {
    // Admin puo' decidere comunque
    const { data: prof } = await supa.from('profiles').select('role').eq('id', user.id).single();
    if (prof?.role !== 'admin') return ApiErrors.forbidden();
  }
  if (ret.status !== 'REQUESTED') {
    return ApiErrors.conflict(`Reso gia' in stato ${ret.status}`);
  }

  const admin = getAdminSupabase();

  let refundId: string | null = null;
  let refundedAt: string | null = null;
  let newStatus: string = body.decision;

  if (body.decision === 'APPROVED' && body.refundAmountCents) {
    // Refund reale + claw-back del transfer se il venditore era già pagato.
    const { data: order } = await admin
      .from('orders')
      .select('stripe_payment_intent')
      .eq('id', ret.order_id)
      .single();

    if (isStripeConfigured() && order?.stripe_payment_intent) {
      try {
        const res = await refundOrder({
          orderId: ret.order_id,
          amountCents: body.refundAmountCents,
          reason: body.notes ?? 'requested_by_customer',
          metadata: { return_id: ret.id },
          notifyBuyer: true,
        });
        refundId = res.refundId;
        refundedAt = new Date().toISOString();
        newStatus = 'REFUNDED';
      } catch (err) {
        logger.error('[returns] refund failed', err);
        return ApiErrors.badGateway('Refund Stripe fallito: ' + (err instanceof Error ? err.message : 'unknown'));
      }
    }
  }

  const { error: updErr } = await admin
    .from('returns')
    .update({
      status: newStatus,
      decided_at: new Date().toISOString(),
      decided_by: user.id,
      decision_notes: body.notes ?? null,
      refund_amount_cents: body.refundAmountCents ?? null,
      refund_id: refundId,
      refunded_at: refundedAt,
    })
    .eq('id', params.id);

  if (updErr) return ApiErrors.internal('Update fallito');

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
export const POST = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
  withAuthRateLimit({ name: 'returns-decide', max: 30, windowMs: 10 * 60_000 }, async ({ user }) => handler(req, user, await ctx.params))(req);
