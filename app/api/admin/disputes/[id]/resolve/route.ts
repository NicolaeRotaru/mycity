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
  status: z.enum(['resolved_buyer', 'resolved_seller', 'rejected']),
  notes: z.string().min(10).max(1000),
  refundCents: z.number().int().positive().optional(),
});

/**
 * Admin risolve una dispute interna (reclamo buyer↔seller).
 *
 * Su 'resolved_buyer' + refundCents → emette un rimborso Stripe REALE
 * (refundOrder: refund + claw-back del transfer se il venditore era già stato
 * pagato). 'resolved_buyer' senza importo = risoluzione DB-only valida.
 * 'resolved_seller'/'rejected' = solo aggiornamento DB.
 *
 * NB: usa getAdminSupabase() (service role). La tabella disputes non ha policy
 * RLS UPDATE per il ruolo authenticated, quindi l'update DEVE passare da qui
 * server-side (l'update client-side falliva silenziosamente su 0 righe).
 */
async function handler(req: NextRequest, user: { id: string }, params: { id: string }): Promise<NextResponse> {
  let body;
  try {
    body = Body.parse(await req.json());
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

  // Rimborso reale solo se risolto a favore del buyer con un importo.
  if (body.status === 'resolved_buyer' && body.refundCents) {
    if (!isStripeConfigured()) return ApiErrors.unavailable('Stripe non configurato');
    try {
      const res = await refundOrder({
        orderId: dispute.order_id,
        amountCents: body.refundCents,
        reason: body.notes,
        metadata: { dispute_id: dispute.id },
        notifyBuyer: true,
      });
      refundId = res.refundId;
    } catch (err) {
      logger.error('[disputes] refund failed', err);
      return ApiErrors.badGateway('Rimborso Stripe fallito: ' + (err instanceof Error ? err.message : 'unknown'));
    }
  }

  const { error: updErr } = await admin
    .from('disputes')
    .update({
      status: body.status,
      resolution_notes: body.notes,
      resolved_by: user.id,
      resolved_at: new Date().toISOString(),
      refund_cents: body.refundCents ?? null,
    })
    .eq('id', params.id);

  if (updErr) return ApiErrors.internal('Update fallito');

  // Notifica chi ha aperto il reclamo.
  await admin.from('notifications').insert({
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

  return NextResponse.json({ ok: true, status: body.status, refundId }, { status: 200 });
}

// Rate limit ereditato da withAdminAuth (solo admin). Params Next 14 sync.
export const POST = (req: NextRequest, ctx: { params: { id: string } }) =>
  withAdminAuth(async ({ user }) => handler(req, user, ctx.params))(req);
