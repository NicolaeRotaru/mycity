import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withCronAuth } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

/**
 * Cron: marca come EXPIRED i pending_checkouts scaduti (default 2h).
 *
 * Perché serve: ogni Checkout Session Stripe ha una vita ~24h ma il
 * record-of-intent su DB potrebbe restare PENDING indefinitamente se
 * il buyer abbandona la sessione Stripe senza pagare. Tenerli puliti
 * evita confusione in dashboard admin e libera lo stripe_session_id.
 *
 * Esperti consultati:
 * - SRE: "Esecuzione ogni 30 min. Idempotente. Update-only, niente delete
 *   per audit trail."
 *
 * Setup esterno:
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *     https://yourapp.com/api/cron/expire-checkouts
 */
export const POST = withCronAuth(async (): Promise<NextResponse> => {
  const admin = getAdminSupabase();

  const { data, error } = await admin
    .from('pending_checkouts')
    .update({ status: 'EXPIRED' })
    .eq('status', 'PENDING')
    .lt('expires_at', new Date().toISOString())
    .select('id');

  if (error) {
    logger.error('[cron] expire-checkouts failed', error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const count = data?.length ?? 0;
  if (count > 0) {
    logger.info(`[cron] expired ${count} pending checkouts`);
  }

  return NextResponse.json({ ok: true, expired: count }, { status: 200 });
});
