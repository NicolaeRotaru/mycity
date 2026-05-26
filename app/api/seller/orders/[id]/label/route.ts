import { NextResponse } from 'next/server';
import { getServerSupabase, getCurrentUser } from '@/lib/supabase/server';
import { buildShippingLabel } from '@/lib/shipping/label';

export const runtime = 'nodejs';

/**
 * GET /api/seller/orders/:id/label
 * Genera PDF label 4×6 thermal-ready per stampa.
 * Auth: solo il seller proprietario dell'ordine.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 });

  const supa = getServerSupabase();
  const { data: order, error } = await supa
    .from('orders')
    .select(`
      id, seller_id, total_cents, payment_method,
      delivery_full_name, delivery_address, delivery_zip, delivery_city,
      delivery_phone, delivery_notes,
      profiles!orders_seller_id_fkey ( store_name )
    `)
    .eq('id', params.id)
    .single();

  if (error || !order) return NextResponse.json({ error: 'Ordine non trovato' }, { status: 404 });
  if (order.seller_id !== user.id) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 });
  }

  const sellerName = (order.profiles as any)?.store_name ?? 'MyCity Seller';
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
    totalCents: order.total_cents ?? 0,
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
