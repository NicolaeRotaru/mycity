import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { getKycProvider, viesVatLookup } from '@/lib/kyc/providers';
import { withAuthRateLimit } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';

export const runtime = 'nodejs';

/**
 * Avvia la verifica KYC per l'utente corrente.
 *
 * Pre-requisiti (in profiles):
 *  - kyc_id_doc_front_url presente
 *  - kyc_selfie_url presente (per face match)
 *  - legal_first_name, legal_last_name, legal_birth_date
 *
 * Per i Venditori con P.IVA, fa anche un controllo VIES sulla partita.
 *
 * Se il provider risponde APPROVED subito (mock), il profilo passa a
 * kyc_provider_status=APPROVED. Se PENDING, resta in attesa del webhook
 * provider che chiamera' /api/kyc/webhook.
 */
// Rate limit: 5 check / ora — costo Onfido ~€1.5 a check, anti-abuse
export const POST = withAuthRateLimit({ name: 'kyc-start', max: 5, windowMs: 60 * 60_000 }, async ({ user }): Promise<NextResponse> => {
  const admin = getAdminSupabase();
  const { data: profile } = await admin
    .from('profiles')
    .select(`
      id, role, email,
      legal_first_name, legal_last_name, legal_fiscal_code, legal_birth_date,
      business_vat_number,
      kyc_id_doc_front_url, kyc_id_doc_back_url, kyc_selfie_url,
      rider_license_url, rider_insurance_url
    `)
    .eq('id', user.id)
    .single();

  if (!profile) return ApiErrors.notFound('Profilo non trovato');

  // Validazioni
  if (!profile.kyc_id_doc_front_url) {
    return ApiErrors.invalidRequest("Carica prima il documento d'identita' (fronte).");
  }
  if (!profile.kyc_selfie_url) {
    return ApiErrors.invalidRequest('Carica prima un selfie per la verifica.');
  }
  if (!profile.legal_first_name || !profile.legal_last_name) {
    return ApiErrors.invalidRequest('Compila nome e cognome anagrafici.');
  }
  if (profile.role === 'rider') {
    if (!profile.rider_license_url) {
      return ApiErrors.invalidRequest('Carica la patente (richiesta per scooter/auto).');
    }
    if (!profile.rider_insurance_url) {
      return ApiErrors.invalidRequest('Carica polizza RC valida.');
    }
  }

  // Verifica VAT se seller
  let vatCheck: { valid: boolean; name?: string } | null = null;
  if (profile.role === 'seller' && profile.business_vat_number) {
    vatCheck = await viesVatLookup(profile.business_vat_number);
    if (!vatCheck.valid) {
      return NextResponse.json({
        error: 'P.IVA non valida o non attiva al VIES. Controlla i dati.',
        vatCheck,
      }, { status: 400 });
    }
  }

  // I campi kyc_*_url contengono il PATH nel bucket privato: generiamo signed URL
  // fresche e brevi SOLO ora, al momento del check (nessuna URL persistita nel DB).
  // Fallback legacy: se il valore è già una URL http, la usiamo così com'è.
  const toSignedUrl = async (val: string | null): Promise<string | null> => {
    if (!val) return null;
    if (val.startsWith('http')) return val;
    const { data } = await admin.storage.from('kyc-docs').createSignedUrl(val, 60 * 15);
    return data?.signedUrl ?? null;
  };
  const [idFrontUrl, idBackUrl, selfieUrl] = await Promise.all([
    toSignedUrl(profile.kyc_id_doc_front_url),
    toSignedUrl(profile.kyc_id_doc_back_url),
    toSignedUrl(profile.kyc_selfie_url),
  ]);

  // Provider KYC
  const provider = getKycProvider();
  const result = await provider.startCheck(
    {
      userId: profile.id,
      email: user.email ?? null,
      firstName: profile.legal_first_name,
      lastName: profile.legal_last_name,
      fiscalCode: profile.legal_fiscal_code,
      birthDate: profile.legal_birth_date,
    },
    {
      idFrontUrl,
      idBackUrl,
      selfieUrl,
    },
  );

  if (!result.ok) {
    return ApiErrors.badGateway(result.error ?? 'KYC provider error');
  }

  await admin
    .from('profiles')
    .update({
      kyc_provider_check_id: result.providerCheckId,
      kyc_provider_status: result.status,
      kyc_provider_checked_at: new Date().toISOString(),
    })
    .eq('id', user.id);

  return NextResponse.json({ status: result.status, providerCheckId: result.providerCheckId, vatCheck }, { status: 200 });
});
