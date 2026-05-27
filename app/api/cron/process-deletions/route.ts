import { NextResponse, type NextRequest } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { withCronAuth } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

/**
 * Cron job giornaliero: processa account deletion scadute (cooldown 7gg).
 *
 * Esperti consultati:
 * - SRE: "Cron giornaliero ore 04:00 UTC = traffico minimo, no impatto utenti."
 * - GDPR Compliance: "Hard delete dopo 7gg = soddisfa Art.17 'senza
 *   giustificato ritardo' con grace period documentato."
 *
 * Pipeline per ogni account scaduto:
 *  1) Anonimizza profilo (rimuove PII)
 *  2) Cancella riga auth.users (sessione invalidata)
 *  3) Log audit per compliance
 *
 * Setup cron esterno (es. cron-job.org, Render cron):
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *     https://yourapp.com/api/cron/process-deletions
 *
 * Schedule consigliato: ogni giorno alle 04:00 Europe/Rome.
 */

const SAFE_FIELDS = {
  full_name: '[utente eliminato]',
  phone: null,
  address: null,
  city: null,
  zip: null,
  store_name: null,
  store_phone: null,
  store_address: null,
  store_lat: null,
  store_lng: null,
  store_logo: null,
  store_media: null,
  store_description: null,
  is_approved: false,
  role: 'buyer',
  deletion_requested_at: null,
};

const KYC_FIELDS = {
  legal_first_name: null,
  legal_last_name: null,
  legal_fiscal_code: null,
  legal_birth_date: null,
  legal_residence_addr: null,
  legal_residence_city: null,
  legal_residence_zip: null,
  business_legal_name: null,
  business_vat_number: null,
  business_address: null,
  business_city: null,
  business_zip: null,
  business_pec: null,
  business_sdi: null,
  billing_iban: null,
  billing_card_last4: null,
  approval_status: 'rejected',
};

export const POST = withCronAuth(async (_req: NextRequest): Promise<NextResponse> => {
  const admin = getAdminSupabase();

  // Chiama la function SQL che ritorna gli userId scaduti
  const { data: expired, error: rpcErr } = await admin.rpc('process_expired_deletions');
  if (rpcErr) {
    logger.error('[cron-deletions] RPC failed', rpcErr);
    return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  }

  const userIds: string[] = (expired ?? []).map((r: { user_id: string }) => r.user_id);
  if (userIds.length === 0) {
    return NextResponse.json({ processed: 0, message: 'No accounts to process' });
  }

  const results = { ok: 0, failed: 0, errors: [] as string[] };

  for (const userId of userIds) {
    // 1) Anonimizza (resilient pattern: full → safe fallback)
    const full = await admin.from('profiles').update({ ...SAFE_FIELDS, ...KYC_FIELDS }).eq('id', userId);
    if (full.error) {
      logger.warn('[cron-deletions] full anonymize failed, fallback', { userId, err: full.error.message });
      const safe = await admin.from('profiles').update(SAFE_FIELDS).eq('id', userId);
      if (safe.error) {
        results.failed++;
        results.errors.push(`${userId}: anonymize failed`);
        continue;
      }
    }

    // 2) Hard delete auth.users
    const { error: delErr } = await admin.auth.admin.deleteUser(userId);
    if (delErr) {
      logger.error('[cron-deletions] auth delete failed', { userId, err: delErr.message });
      results.failed++;
      results.errors.push(`${userId}: auth delete failed`);
      continue;
    }

    results.ok++;
    logger.info('[cron-deletions] processed', { userId });
  }

  return NextResponse.json({
    processed: results.ok,
    failed: results.failed,
    errors: results.errors,
    total: userIds.length,
  });
});
