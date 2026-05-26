import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { withAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';

export const runtime = 'nodejs';

/**
 * Cancellazione DEFINITIVA dell'account corrente.
 *
 * Fasi:
 *  1) Anonimizza il profilo (rimuove PII; la riga resta per FK ordini storici)
 *  2) Cancella l'utente da auth.users via Supabase Admin API
 *  3) Le sessioni esistenti diventano invalide
 *
 * Strategia anonimizzazione resiliente:
 *  - Prova prima l'update completo (campi storici + campi KYC migration 021)
 *  - Se fallisce (es. migration non applicata) ricade su update minimale
 *    con i soli campi storici
 *  - Solo se anche il minimale fallisce, ritorna errore
 *
 * Sicurezza:
 *  - Richiede Authorization: Bearer <jwt>
 *  - userId derivato dal token, mai dal body
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

export const POST = withAuth(async ({ user }): Promise<NextResponse> => {
  const supabaseUrl     = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseService = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseService) return ApiErrors.unavailable();

  const admin = createClient(supabaseUrl, supabaseService, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1) Anonimizzazione resiliente
  const full = await admin.from('profiles').update({ ...SAFE_FIELDS, ...KYC_FIELDS }).eq('id', user.id);
  if (full.error) {
    logger.warn('account delete: full anonymize failed, fallback', full.error.message);
    const safe = await admin.from('profiles').update(SAFE_FIELDS).eq('id', user.id);
    if (safe.error) {
      logger.error('account delete: even safe anonymize failed', safe.error);
      return NextResponse.json(
        { error: 'Impossibile aggiornare il profilo. Contatta il supporto.' },
        { status: 500 },
      );
    }
  }

  // 2) Cancellazione hard
  const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
  if (delErr) {
    logger.error('account delete: auth deletion failed', delErr);
    return NextResponse.json(
      { error: "Profilo anonimizzato ma cancellazione dell'account non riuscita. Contatta il supporto." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true }, { status: 200 });
});
