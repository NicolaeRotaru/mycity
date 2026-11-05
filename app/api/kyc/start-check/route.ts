import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { getKycProvider, viesVatLookup } from '@/lib/kyc/providers';
import { withAuthRateLimit } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { writeAudit } from '@/lib/audit';
import { cancelloEtaServer } from '@/lib/maggiore-eta';
import { rispostaPerErroreDatabase } from '@/lib/api/errore-database';

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
  // `profiles` non ha la colonna `email` (sta in auth.users, e qui arriva gia' da `user.email`):
  // chiederla faceva fallire TUTTA la lettura (42703) e la rotta rispondeva «Profilo non trovato».
  const { data: profile, error: erroreProfilo } = await admin
    .from('profiles')
    .select(`
      id, role,
      legal_first_name, legal_last_name, legal_fiscal_code, legal_birth_date,
      business_vat_number,
      kyc_id_doc_front_url, kyc_id_doc_back_url, kyc_selfie_url,
      rider_license_url, rider_insurance_url,
      kyc_provider_check_id, kyc_provider_status
    `)
    .eq('id', user.id)
    .single();

  // Un guasto del database non e' un profilo mancante: chi legge deve poterli distinguere.
  // Con `.single()` la riga che non c'e' arriva come PGRST116: quello e' «non trovato», non un guasto.
  // (Resta `.single()` e non `.maybeSingle()`: e' il contratto che le altre rotte KYC e le loro prove usano.)
  const profiloAssente = erroreProfilo?.code === 'PGRST116';
  if (erroreProfilo && !profiloAssente) {
    return rispostaPerErroreDatabase(erroreProfilo, 'kyc/start-check', 'Non riesco a leggere il profilo, riprova tra poco');
  }
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
  /**
   * 8/9/2026 — LA DATA DI NASCITA LA LEGGEVAMO SOLO PER PASSARLA AL FORNITORE.
   *
   * Venti righe più sotto `legal_birth_date` finiva dentro `startCheck` come
   * dato da mandare avanti, e nessuno la confrontava con niente: il fornitore
   * oggi è interno, quindi la verifica di un quindicenne partiva e poteva
   * tornare «APPROVED». Il campo è nato per il KYC come «dato da spedire»; qui
   * diventa una regola.
   */
  const cancelloEta = cancelloEtaServer(profile);
  if (!cancelloEta.ok) {
    return cancelloEta.stato === 403
      ? ApiErrors.forbidden(cancelloEta.messaggio ?? '')
      : ApiErrors.invalidRequest(cancelloEta.messaggio ?? '');
  }
  if (profile.role === 'rider') {
    if (!profile.rider_license_url) {
      return ApiErrors.invalidRequest('Carica la patente (richiesta per scooter/auto).');
    }
    if (!profile.rider_insurance_url) {
      return ApiErrors.invalidRequest('Carica polizza RC valida.');
    }
  }

  // 5/11/2026 (S05) — Una verifica già in attesa non se ne crea un'altra: con un
  // fornitore vero ogni chiamata apriva una nuova scheda con nome, email e data di
  // nascita, senza documenti, che nessuno cancellava.
  const giaInAttesa = (profile as { kyc_provider_status?: string | null; kyc_provider_check_id?: string | null });
  // La verifica manuale (id «manual_…») non apre schede fuori: lì si rilancia, così una
  // P.IVA o un nome corretti si ricontrollano.
  if (giaInAttesa.kyc_provider_status === 'PENDING' && giaInAttesa.kyc_provider_check_id
      && !giaInAttesa.kyc_provider_check_id.startsWith('manual_')) {
    return NextResponse.json({ status: 'PENDING', providerCheckId: giaInAttesa.kyc_provider_check_id, vatCheck: null }, { status: 200 });
  }

  // Verifica VAT se seller
  let vatCheck: { valid: boolean; name?: string; irraggiungibile?: boolean } | null = null;
  if (profile.role === 'seller' && profile.business_vat_number) {
    vatCheck = await viesVatLookup(profile.business_vat_number);
    // 5/11/2026 (S05) — VIES irraggiungibile non è «P.IVA non valida».
    if (vatCheck.irraggiungibile) {
      return ApiErrors.unavailable('Il servizio europeo VIES non risponde: non posso controllare la partita IVA. Riprova tra poco.');
    }
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
  if (!idFrontUrl || !selfieUrl) {
    return ApiErrors.internal('Impossibile generare gli URL firmati dei documenti.');
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
      idFrontUrl,
      idBackUrl,
      selfieUrl,
    },
  );

  if (!result.ok) {
    return ApiErrors.badGateway(result.error ?? 'KYC provider error');
  }

  const { error: erroreSalvataggio } = await admin
    .from('profiles')
    .update({
      kyc_provider_check_id: result.providerCheckId,
      kyc_provider_status: result.status,
      kyc_provider_checked_at: new Date().toISOString(),
    })
    .eq('id', user.id);
  // 5/11/2026 (S05) — Se lo stato non si salva, non si dice «verifica in corso»:
  // nel profilo non resterebbe traccia della richiesta.
  if (erroreSalvataggio) {
    return rispostaPerErroreDatabase(erroreSalvataggio, 'kyc/start-check', 'Non sono riuscito a registrare la verifica: riprova tra poco');
  }

  // 🟠-23: traccia in audit_logs la decisione KYC terminale. 5/11/2026 (S05): anche
  // l'INVIO (PENDING) lascia la sua riga, con l'ora: kyc_provider_checked_at si
  // sovrascrive a ogni tentativo, il registro no.
  await writeAudit({
    actorId: user.id,
    action: result.status === 'APPROVED' ? 'kyc.approve' : 'kyc.submit',
    targetTable: 'profiles',
    targetId: user.id,
    metadata: { role: profile.role, providerCheckId: result.providerCheckId ?? null, stato: result.status, via: 'start-check' },
  });

  return NextResponse.json({ status: result.status, providerCheckId: result.providerCheckId, vatCheck }, { status: 200 });
});
