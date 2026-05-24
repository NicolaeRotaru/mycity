import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, getServerSupabase, getAdminSupabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const Body = z.object({
  orderId: z.string().uuid(),
  cashCollectedCents: z.number().int().nonnegative(),
  photoUrl: z.string().url().optional(),
  signatureUrl: z.string().url().optional(),
  deliveryPhotoUrl: z.string().url().optional(),
});

/**
 * Il rider conferma di aver incassato contanti al momento della consegna.
 *
 * Salva:
 *  - cash_collected_cents (importo)
 *  - cash_photo_url (foto contanti/scontrino)
 *  - cash_signature_url (firma digitale buyer, opzionale)
 *  - delivery_photo_url (foto pacco lasciato)
 *  - cash_confirmed_at + cash_collected_by
 *
 * Aggiorna il record cod_reconciliations per la giornata (anche
 * giornaliera): expected viene calcolato come somma total_price di
 * tutti gli ordini COD delivered dal rider quel giorno.
 *
 * RLS-safe: il rider puo' aggiornare solo i propri ordini con
 * delivery_status PICKED_UP/OUT_FOR_DELIVERY/DELIVERED (controllo
 * server-side).
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
  const { data: order, error } = await supa
    .from('orders')
    .select('id, rider_id, total_price, payment_method, delivery_status, cash_confirmed_at')
    .eq('id', body.orderId)
    .single();

  if (error || !order) return NextResponse.json({ error: 'Ordine non trovato' }, { status: 404 });
  if (order.rider_id !== user.id) {
    return NextResponse.json({ error: 'Non autorizzato (ordine di altro rider)' }, { status: 403 });
  }
  if (order.payment_method !== 'cod') {
    return NextResponse.json({ error: 'Ordine non in cash on delivery' }, { status: 409 });
  }
  if (order.cash_confirmed_at) {
    return NextResponse.json({ error: 'Incasso gia\' confermato' }, { status: 409 });
  }

  const admin = getAdminSupabase();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  const { error: updErr } = await admin
    .from('orders')
    .update({
      cash_collected_cents: body.cashCollectedCents,
      cash_photo_url: body.photoUrl ?? null,
      cash_signature_url: body.signatureUrl ?? null,
      delivery_photo_url: body.deliveryPhotoUrl ?? null,
      cash_confirmed_at: now.toISOString(),
      cash_collected_by: user.id,
    })
    .eq('id', body.orderId);

  if (updErr) return NextResponse.json({ error: 'Update fallito' }, { status: 500 });

  // Aggiorna riconciliazione giornaliera
  await upsertReconciliation(admin, user.id, today);

  // Alert immediato se delta > 5%
  const expectedCents = Math.round(Number(order.total_price) * 100);
  const delta = body.cashCollectedCents - expectedCents;
  const deltaPct = expectedCents > 0 ? Math.abs(delta) / expectedCents : 0;
  if (deltaPct > 0.05) {
    await admin.from('notifications').insert({
      user_id: user.id,
      title: '⚠️ Incasso non quadra',
      body: `Ordine ${body.orderId.slice(0, 8)}: incassati €${(body.cashCollectedCents/100).toFixed(2)}, attesi €${(expectedCents/100).toFixed(2)}.`,
    });
  }

  return NextResponse.json({ ok: true, delta }, { status: 200 });
}

async function upsertReconciliation(admin: any, riderId: string, isoDate: string) {
  // Calcola expected e collected per quel giorno
  const start = `${isoDate}T00:00:00Z`;
  const end = `${isoDate}T23:59:59Z`;

  const { data: rows } = await admin
    .from('orders')
    .select('total_price, cash_collected_cents')
    .eq('rider_id', riderId)
    .eq('payment_method', 'cod')
    .eq('delivery_status', 'DELIVERED')
    .gte('cash_confirmed_at', start)
    .lte('cash_confirmed_at', end);

  const expected = (rows ?? []).reduce(
    (s: number, r: any) => s + Math.round(Number(r.total_price) * 100), 0,
  );
  const collected = (rows ?? []).reduce(
    (s: number, r: any) => s + Number(r.cash_collected_cents ?? 0), 0,
  );

  const status = expected === collected ? 'OK' : 'MISMATCH';

  await admin
    .from('cod_reconciliations')
    .upsert(
      {
        rider_id: riderId,
        for_date: isoDate,
        expected_cents: expected,
        collected_cents: collected,
        status,
      },
      { onConflict: 'rider_id,for_date' },
    );
}
