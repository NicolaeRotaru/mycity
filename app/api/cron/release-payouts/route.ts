import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withCronAuth } from '@/lib/api/middleware';
import { isStripeConfigured } from '@/lib/stripe/client';
import { releaseOrderPayout } from '@/lib/stripe/payout';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

const HOLD_DAYS = 3;
const BATCH_LIMIT = 200;
const OPEN_RETURN_STATUSES = ['REQUESTED', 'APPROVED', 'SHIPPED_BACK', 'RECEIVED'];
const OPEN_DISPUTE_STATUSES = ['open', 'under_review'];

/**
 * Cron: rilascia automaticamente i payout SCT ai venditori per gli ordini
 * consegnati da almeno HOLD_DAYS giorni. Policy: consegna +3gg, con claw-back
 * via reversal per rimborsi/recessi tardivi (vedi lib/stripe/payout.ts).
 *
 * Eleggibilità (filtri SQL, coperti da orders_payout_release_idx):
 *   payout_status IN ('HELD','PENDING_SELLER_ONBOARDING')
 *   AND payment_method = 'card'        (i COD non passano da Stripe)
 *   AND delivery_status = 'DELIVERED'
 *   AND delivered_at <= now() - 3gg
 *   AND dispute_status IS NULL         (nessun chargeback Stripe aperto)
 * Esclusioni applicative: ordini con un reso aperto o una dispute interna
 * aperta vengono saltati (i fondi restano HELD).
 *
 * Idempotente: releaseOrderPayout è no-op se lo stato non è più HELD.
 * Best-effort per ordine: un transfer fallito non blocca il batch; il giro
 * successivo riprende i rimanenti (limit BATCH_LIMIT per esecuzione).
 *
 * Setup esterno (giornaliero basta per un gate di +3gg):
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *     https://yourapp.com/api/cron/release-payouts
 */
export const POST = withCronAuth(async (): Promise<NextResponse> => {
  if (!isStripeConfigured()) {
    return NextResponse.json({ ok: false, error: 'Stripe non configurato' }, { status: 503 });
  }

  const admin = getAdminSupabase();
  const cutoffIso = new Date(Date.now() - HOLD_DAYS * 86_400_000).toISOString();

  const { data: candidates, error } = await admin
    .from('orders')
    .select('id')
    .in('payout_status', ['HELD', 'PENDING_SELLER_ONBOARDING'])
    .eq('payment_method', 'card')
    .eq('delivery_status', 'DELIVERED')
    .is('dispute_status', null)
    .lte('delivered_at', cutoffIso)
    .limit(BATCH_LIMIT);

  if (error) {
    logger.error('[cron] release-payouts query failed', error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const ids = (candidates ?? []).map((o) => o.id as string);
  if (ids.length === 0) {
    return NextResponse.json({ ok: true, released: 0, skipped: 0, failed: 0 }, { status: 200 });
  }

  // Escludi ordini con un reso aperto o una dispute interna aperta.
  const blocked = new Set<string>();
  const [openReturns, openDisputes] = await Promise.all([
    admin.from('returns').select('order_id').in('order_id', ids).in('status', OPEN_RETURN_STATUSES),
    admin.from('disputes').select('order_id').in('order_id', ids).in('status', OPEN_DISPUTE_STATUSES),
  ]);
  for (const r of openReturns.data ?? []) blocked.add(r.order_id as string);
  for (const d of openDisputes.data ?? []) blocked.add(d.order_id as string);

  let released = 0;
  let skipped = 0;
  let failed = 0;

  for (const id of ids) {
    if (blocked.has(id)) {
      skipped++;
      continue;
    }
    try {
      const res = await releaseOrderPayout(id);
      if (res.ok) released++;
      else if (res.code === 'SELLER_NOT_READY' || res.code === 'BAD_STATE') skipped++;
      else failed++;
    } catch (e) {
      logger.error('[cron] release-payouts order failed', { id, e });
      failed++;
    }
  }

  if (released > 0 || failed > 0) {
    logger.info(`[cron] release-payouts: released=${released} skipped=${skipped} failed=${failed}`);
  }

  return NextResponse.json({ ok: true, released, skipped, failed }, { status: 200 });
});
