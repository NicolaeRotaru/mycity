import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getAdminSupabase } from '@/lib/supabase/admin';
import { withSellerAuth } from '@/lib/api/middleware';
import { ApiErrors, apiSuccess } from '@/lib/api/responses';
import { refundOrder } from '@/lib/stripe/payout';

export const runtime = 'nodejs';

/**
 * POST /api/seller/orders/:id/reject
 * Rifiuta un ordine. Se l'ordine è pagato con carta (payment_status='PAID'),
 * emette il rimborso Stripe PRIMA di annullare — la RPC seller_reject_order
 * da sola non gestisce Stripe.
 * Auth: solo il seller proprietario dell'ordine.
 */
async function handler(req: NextRequest, user: { id: string }, params: { id: string }) {
  const body = await req.json().catch(() => ({}));
  const reason: string | null = typeof body.reason === 'string' ? body.reason : null;

  const admin = getAdminSupabase();

  const { data: order, error } = await admin
    .from('orders')
    .select('id, seller_id, payment_method, payment_status, total_price, delivery_status')
    .eq('id', params.id)
    .single();

  if (error || !order) return ApiErrors.notFound('Ordine non trovato');
  if (order.seller_id !== user.id) return ApiErrors.forbidden();

  if (!['NEW', 'ACCEPTED'].includes(order.delivery_status ?? '')) {
    return NextResponse.json(
      { ok: false, error: { code: 'TOO_LATE', message: 'Ordine non rifiutabile in questo stato' } },
      { status: 422 },
    );
  }

  // Se l'ordine è stato pagato con carta, rimborsa PRIMA di annullare.
  const isCardPaid =
    order.payment_method === 'card' && order.payment_status === 'PAID';

  if (isCardPaid) {
    const totalCents = Math.round(Number(order.total_price) * 100);
    if (totalCents > 0) {
      await refundOrder({
        orderId: order.id,
        amountCents: totalCents,
        reason: 'Ordine rifiutato dal negozio',
        idempotencyKey: `seller_reject_${order.id}`,
        notifyBuyer: true,
      });
    }
  }

  // Annulla tramite RPC (ripristina stock, notifica buyer, aggiorna stato).
  const supa = await getServerSupabase();
  const { data: rpcResult, error: rpcErr } = await supa.rpc('seller_reject_order', {
    p_order_id: params.id,
    p_reason: reason,
  });

  if (rpcErr) {
    return NextResponse.json(
      { ok: false, error: { code: 'RPC_FAILED', message: rpcErr.message } },
      { status: 500 },
    );
  }

  const result = rpcResult as { ok: boolean; reason?: string };
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: { code: result.reason ?? 'REJECT_FAILED', message: 'Impossibile rifiutare' } },
      { status: 422 },
    );
  }

  return apiSuccess({ refunded: isCardPaid });
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  return withSellerAuth((r, u) => handler(r, u, params))(req);
}
