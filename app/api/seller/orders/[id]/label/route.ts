import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
// #12 — La cartella si chiamava `lib/shipping/`, come il file `lib/shipping.ts`
// che sta accanto: due cose diverse con lo stesso nome. Un `import from
// '@/lib/shipping'` prende il file, `'@/lib/shipping/label'` prende la
// cartella, e chi legge non ha modo di accorgersi della differenza. Rinominata.
import { buildShippingLabel } from '@/lib/shipping-etichetta/label';
import { withSellerAuthRateLimit } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';

export const runtime = 'nodejs';

/**
 * GET /api/seller/orders/:id/label
 * Genera PDF label 4×6 thermal-ready per stampa.
 * Auth: solo il seller proprietario dell'ordine.
 */
async function handler(_req: NextRequest, user: { id: string }, params: { id: string }) {
  const supa = await getServerSupabase();
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

// 27/8/2026 (R140) — ERA `withSellerAuth`, SENZA FRENO, sulla rotta piu' cara
// del lotto: ogni chiamata compone un PDF. `withSellerAuthRateLimit` esisteva
// gia' nello stesso file di involucri, e qui non era stato usato. Sessanta
// etichette in dieci minuti sono piu' di quante un negozio ne stampi in un
// giorno pieno.
export const GET = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
  withSellerAuthRateLimit({ name: 'seller-label', max: 60, windowMs: 10 * 60_000 }, async ({ user }) =>
    handler(req, user, await ctx.params))(req);
