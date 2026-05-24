import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, getServerSupabase, getAdminSupabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const REASON = z.enum(['DAMAGED', 'WRONG_ITEM', 'NOT_AS_DESCRIBED', 'CHANGED_MIND', 'LATE', 'OTHER']);

const Body = z.object({
  orderId: z.string().uuid(),
  orderItemId: z.string().uuid().optional(),
  reason: REASON,
  notes: z.string().max(2000).optional(),
  photoUrls: z.array(z.string().url()).max(8).optional(),
});

/**
 * Apre una richiesta di reso. Vincoli:
 *  - L'ordine deve essere DELIVERED
 *  - L'utente deve esserne il buyer
 *  - Entro 14 giorni dalla consegna (recesso legale)
 *
 * Lo stato iniziale e' REQUESTED. Il seller ricevera' notifica e
 * potra' approvare/rifiutare via /api/returns/[id]/decide.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Autenticazione richiesta' }, { status: 401 });

  let body;
  try {
    body = Body.parse(await req.json());
  } catch (e: any) {
    return NextResponse.json({ error: 'Dati non validi', details: e?.message }, { status: 400 });
  }

  const supa = getServerSupabase();
  const { data: order, error: oErr } = await supa
    .from('orders')
    .select('id, user_id, seller_id, delivery_status, delivered_at, total_price')
    .eq('id', body.orderId)
    .single();

  if (oErr || !order) return NextResponse.json({ error: 'Ordine non trovato' }, { status: 404 });
  if (order.user_id !== user.id) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 });
  }
  if (order.delivery_status !== 'DELIVERED') {
    return NextResponse.json({ error: 'L\'ordine non risulta consegnato' }, { status: 409 });
  }

  // Vincolo 14 giorni dal consegna (recesso)
  if (order.delivered_at) {
    const deliveredAt = new Date(order.delivered_at).getTime();
    const days = (Date.now() - deliveredAt) / (1000 * 60 * 60 * 24);
    if (days > 14) {
      return NextResponse.json({
        error: 'Termine per il recesso scaduto (14 giorni dalla consegna).',
      }, { status: 409 });
    }
  }

  // Anti-doppione: max 1 reso open per ordine
  const { data: existing } = await supa
    .from('returns')
    .select('id, status')
    .eq('order_id', body.orderId)
    .in('status', ['REQUESTED', 'APPROVED', 'SHIPPED_BACK', 'RECEIVED'])
    .limit(1)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ error: 'Esiste gia\' una richiesta di reso aperta per questo ordine' }, { status: 409 });
  }

  const admin = getAdminSupabase();
  const { data: ret, error: insErr } = await admin
    .from('returns')
    .insert({
      order_id: body.orderId,
      order_item_id: body.orderItemId ?? null,
      buyer_id: user.id,
      seller_id: order.seller_id,
      reason: body.reason,
      notes: body.notes ?? null,
      photo_urls: body.photoUrls ?? [],
      status: 'REQUESTED',
    })
    .select('id')
    .single();

  if (insErr || !ret) {
    console.error('[returns] insert failed', insErr);
    return NextResponse.json({ error: 'Creazione reso fallita' }, { status: 500 });
  }

  // Notifica seller (best-effort)
  await admin.from('notifications').insert({
    user_id: order.seller_id,
    title: '↩️ Nuova richiesta di reso',
    body: `Il cliente ha richiesto il reso per l'ordine #${order.id.slice(0, 8)}`,
    link: `/seller/orders/${order.id}`,
  });

  return NextResponse.json({ id: ret.id, status: 'REQUESTED' }, { status: 201 });
}
