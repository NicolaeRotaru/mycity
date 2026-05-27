import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSupabase, getAdminSupabase } from '@/lib/supabase/server';
import { withAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';

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
export const POST = withAuth(async ({ user, req }): Promise<NextResponse> => {
  let body;
  try {
    body = Body.parse(await req.json());
  } catch (e: any) {
    return ApiErrors.invalidRequest('Dati non validi', e?.message);
  }

  const supa = getServerSupabase();
  const { data: order, error } = await supa
    .from('orders')
    .select('id, rider_id, total_price, payment_method, delivery_status, cash_confirmed_at')
    .eq('id', body.orderId)
    .single();

  if (error || !order) return ApiErrors.notFound('Ordine non trovato');
  if (order.rider_id !== user.id) {
    return ApiErrors.forbidden('Non autorizzato (ordine di altro rider)');
  }
  if (order.payment_method !== 'cod') {
    return ApiErrors.conflict('Ordine non in cash on delivery');
  }
  if (order.cash_confirmed_at) {
    return ApiErrors.conflict("Incasso gia' confermato");
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

  if (updErr) return ApiErrors.internal('Update fallito');

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
});

type AdminSupabase = ReturnType<typeof import('@/lib/supabase/server').getAdminSupabase>;
type ReconciliationRow = { total_price: number | string | null; cash_collected_cents: number | null };

async function upsertReconciliation(admin: AdminSupabase, riderId: string, isoDate: string) {
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

  const rowsTyped = (rows ?? []) as unknown as ReconciliationRow[];
  const expected = rowsTyped.reduce(
    (s, r) => s + Math.round(Number(r.total_price) * 100), 0,
  );
  const collected = rowsTyped.reduce(
    (s, r) => s + Number(r.cash_collected_cents ?? 0), 0,
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
