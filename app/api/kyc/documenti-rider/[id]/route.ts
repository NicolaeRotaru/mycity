import { NextResponse, type NextRequest } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { getClientIp } from '@/lib/rate-limit';
import { withAdminAuth } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { writeAudit } from '@/lib/audit';
import type { DatiEsameRider, DocumentoRider } from '@/lib/kyc/esame-rider';

export const runtime = 'nodejs';

/** I link ai documenti valgono due minuti: bastano per aprirli, non per farli girare. */
const SCADENZA_LINK_SECONDI = 120;

/**
 * I documenti di UN fattorino, per l'amministratore che lo sta esaminando.
 *
 * Senza questa rotta il pannello «Esamina» non aveva niente da mostrare: in
 * produzione la verifica e' solo manuale, e chi approvava non vedeva ne'
 * patente, ne' polizza, ne' documento, ne' data di nascita.
 *
 * Solo admin. I file stanno nel bucket privato `kyc-docs`: qui si generano
 * link firmati brevi, al momento, e non si salvano da nessuna parte. Ogni
 * lettura lascia una riga nel registro: chi, quando, di chi.
 */
async function handler(req: NextRequest, adminUser: { id: string }, targetId: string) {
  // R14-017 — La regola larga `[0-9a-f-]{36}` lasciava passare 36 trattini, e
  // il database rispondeva con un guasto (500): un uuid vero ha la forma 8-4-4-4-12.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetId)) {
    return ApiErrors.invalidRequest('ID non valido');
  }

  const admin = getAdminSupabase();
  const { data, error } = await admin
    .from('profiles')
    .select(`
      id, role, legal_birth_date,
      kyc_id_doc_front_url, kyc_id_doc_back_url, kyc_selfie_url,
      rider_license_url, rider_license_expires_on,
      rider_insurance_url, rider_insurance_expires_on,
      rider_haccp_url, rider_haccp_expires_on,
      rider_vehicle_type, rider_vehicle_plate
    `)
    .eq('id', targetId)
    .maybeSingle();

  if (error) return ApiErrors.internal('Lettura non riuscita.');
  if (!data) return ApiErrors.notFound('Utente non trovato.');
  if (data.role !== 'rider') return ApiErrors.invalidRequest('Questo utente non e\' un fattorino.');

  const firma = async (val: string | null): Promise<string | null> => {
    if (!val) return null;
    if (val.startsWith('http')) return val; // valori vecchi, gia' salvati come link
    const { data: firmato } = await admin.storage.from('kyc-docs').createSignedUrl(val, SCADENZA_LINK_SECONDI);
    return firmato?.signedUrl ?? null;
  };

  const [fronte, retro, selfie, patente, polizza, haccp] = await Promise.all([
    firma(data.kyc_id_doc_front_url),
    firma(data.kyc_id_doc_back_url),
    firma(data.kyc_selfie_url),
    firma(data.rider_license_url),
    firma(data.rider_insurance_url),
    firma(data.rider_haccp_url),
  ]);

  const documenti: DocumentoRider[] = [
    { chiave: 'documento_fronte', etichetta: "Documento d'identità (fronte)", url: fronte, scade_il: null },
    { chiave: 'documento_retro', etichetta: "Documento d'identità (retro)", url: retro, scade_il: null },
    { chiave: 'selfie', etichetta: 'Selfie', url: selfie, scade_il: null },
    { chiave: 'patente', etichetta: 'Patente', url: patente, scade_il: data.rider_license_expires_on ?? null },
    { chiave: 'polizza', etichetta: 'Polizza RC', url: polizza, scade_il: data.rider_insurance_expires_on ?? null },
    { chiave: 'haccp', etichetta: 'Attestato HACCP', url: haccp, scade_il: data.rider_haccp_expires_on ?? null },
  ];

  await writeAudit({
    actorId: adminUser.id,
    // 5/11/2026 — Guardare i documenti non è approvarli: prima finiva come «KYC approvato».
    action: 'kyc.view',
    targetTable: 'profiles',
    targetId,
    metadata: { evento: 'lettura_documenti_rider', documenti: documenti.filter((d) => d.url).map((d) => d.chiave) },
    ip: getClientIp(req),
    userAgent: req.headers.get('user-agent') ?? undefined,
  });

  const corpo: DatiEsameRider = {
    legal_birth_date: data.legal_birth_date ?? null,
    documenti,
    veicolo: { tipo: data.rider_vehicle_type ?? null, targa: data.rider_vehicle_plate ?? null },
  };
  return NextResponse.json(corpo, { headers: { 'Cache-Control': 'no-store' } });
}

export const GET = withAdminAuth(({ req, user, params }) => handler(req, user, String(params.id)));
