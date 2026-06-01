import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { withAdminAuthRateLimit } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';

/**
 * Cancellazione di un account da parte di un admin.
 * Pipeline = a /api/account/delete ma:
 *  - target preso da [id] in URL (non dal token)
 *  - chiamante deve essere admin (verificato via DB)
 *  - admin non puo' cancellare se stesso da qui (anti lock-out)
 *  - errori dettagliati nel response (utile per debug, e' admin)
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

async function handler(_req: NextRequest, caller: { id: string }, { params }: { params: { id: string } }) {
  const targetId = params.id;

  const supabaseUrl     = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseService = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseService) return ApiErrors.unavailable();
  if (!targetId || targetId.length < 10) return ApiErrors.invalidRequest('ID utente non valido.');

  const admin = createClient(supabaseUrl, supabaseService, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Anti lock-out
  if (caller.id === targetId) {
    return ApiErrors.invalidRequest('Non puoi eliminare il tuo stesso account da qui. Usa Impostazioni → Elimina account.');
  }

  // Esistenza target
  const { data: targetProfile } = await admin
    .from('profiles')
    .select('id, role, full_name, store_name')
    .eq('id', targetId)
    .single();
  if (!targetProfile) return ApiErrors.notFound('Utente non trovato.');

  // 5) Anonimizzazione resiliente
  const full = await admin.from('profiles').update({ ...SAFE_FIELDS, ...KYC_FIELDS }).eq('id', targetId);
  if (full.error) {
    logger.warn('admin delete: full anonymize failed, fallback', full.error.message);
    const safe = await admin.from('profiles').update(SAFE_FIELDS).eq('id', targetId);
    if (safe.error) {
      logger.error('admin delete: even safe anonymize failed', safe.error);
      // L'admin si merita il dettaglio dell'errore
      return NextResponse.json(
        { error: `Anonimizzazione fallita: ${safe.error.message}`, code: safe.error.code },
        { status: 500 },
      );
    }
  }

  // 6) Cancella da auth.users
  const { error: delErr } = await admin.auth.admin.deleteUser(targetId);
  if (delErr) {
    logger.error('admin delete: auth deletion failed', delErr);
    return NextResponse.json(
      { error: `Profilo anonimizzato ma cancellazione auth fallita: ${delErr.message}` },
      { status: 500 },
    );
  }

  await writeAudit({
    actorId: caller.id,
    action: 'user.delete',
    targetTable: 'profiles',
    targetId: targetId,
    metadata: { role: targetProfile.role, name: targetProfile.store_name ?? targetProfile.full_name },
  });

  return NextResponse.json({
    ok: true,
    deleted: { id: targetId, role: targetProfile.role, name: targetProfile.store_name ?? targetProfile.full_name },
  });
}

// Rate limit destructive: 20 cancellazioni / ora per admin (anti-abuse + audit trail)
export const DELETE = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
  withAdminAuthRateLimit({ name: 'admin-delete-user', max: 20, windowMs: 60 * 60_000 }, async ({ user }) => handler(req, user, { params: await ctx.params }))(req);
