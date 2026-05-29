import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { buildShippingLabel } from '@/lib/shipping/label';
import { withSellerAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';

export const runtime = 'nodejs';

/**
 * GET /api/seller/orders/:id/label
 * Genera PDF label 4×6 thermal-ready per stampa.
 * Auth: solo il seller proprietario dell'ordine.
 */
async function handler(_req: NextRequest, user: { id: string }, params: { id: string }) {
  const supa = getServerSupabase();
  const { data: order, error } = await supa
    .from('orders')
    .select(`
      id, seller_id, total_price, payment_method,
      delivery_full_name, delivery_address, delivery_zip, delivery_city,
      delivery_phone, delivery_notes,
      profiles!orders_seller_id_fkey ( store_name )
    `)
    .eq('id', params.id)
    .single();

  if (error || !order) return ApiErrors.notFound('Ordine non trovato');
  if (order.seller_id !== user.id) return ApiErrors.forbidden();

  const sellerName = (order.profiles as { store_name?: string | null } | null)?.store_name ?? 'MyCity Seller';
  const isCod = order.payment_method === 'cod' || order.payment_method === null;

  const pdf = await buildShippingLabel({
    orderId: order.id,
    recipientName: order.delivery_full_name ?? 'Cliente',
    street: order.delivery_address ?? '',
    zip: order.delivery_zip ?? '',
    city: order.delivery_city ?? 'Piacenza',
    phone: order.delivery_phone ?? '',
    notes: order.delivery_notes ?? undefined,
    sellerName,
    totalCents: Math.round(Number(order.total_price ?? 0) * 100),
    isCod,
  });

  // Cast a Uint8Array per compatibilità BodyInit di NextResponse
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="label-${order.id.slice(0, 8)}.pdf"`,
      'Cache-Control': 'private, no-cache',
    },
  });
}

export const GET = (req: NextRequest, ctx: { params: { id: string } }) =>
  withSellerAuth(async ({ user }) => handler(req, user, ctx.params))(req);
