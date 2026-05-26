import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { getKycProvider, viesVatLookup } from '@/lib/kyc/providers';
import { withAuth } from '@/lib/api/middleware';
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
export const POST = withAuth(async ({ user }): Promise<NextResponse> => {
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
      idFrontUrl: profile.kyc_id_doc_front_url,
      idBackUrl: profile.kyc_id_doc_back_url,
      selfieUrl: profile.kyc_selfie_url,
    },
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
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
