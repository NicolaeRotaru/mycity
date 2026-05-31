import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { withAuthRateLimit } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';

export const runtime = 'nodejs';

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const ALLOWED_KINDS = new Set([
  'id_front', 'id_back', 'selfie',
  'rider_license', 'rider_insurance', 'rider_haccp',
]);

/**
 * Upload di documento KYC in bucket privato "kyc-docs".
 *
 * - Solo l'utente autenticato puo' caricare per se' stesso.
 * - I file vanno in path `{userId}/{kind}-{timestamp}.{ext}`.
 * - Il bucket NON e' pubblico: gli URL si generano signed con
 *   createSignedUrl quando servono (admin review, provider KYC).
 *
 * Salva il PATH del file (non una signed URL) nelle colonne profile
 * corrispondenti: kyc_id_doc_front_url, kyc_id_doc_back_url, kyc_selfie_url,
 * rider_license_url, rider_insurance_url, rider_haccp_url. Le signed URL si
 * generano on-demand con TTL breve (no esposizione di URL valide nel DB).
 */
// Rate limit: 20 upload / 10 min per utente (anti-abuse + protezione storage)
export const POST = withAuthRateLimit({ name: 'kyc-upload', max: 20, windowMs: 10 * 60_000 }, async ({ user, req }): Promise<NextResponse> => {
  const form = await req.formData();
  const file = form.get('file');
  const kindRaw = form.get('kind');
  const kind = typeof kindRaw === 'string' ? kindRaw : '';

  if (!ALLOWED_KINDS.has(kind)) return ApiErrors.invalidRequest('Tipo documento non valido');
  if (!(file instanceof File)) return ApiErrors.invalidRequest('File mancante');
  if (file.size > MAX_BYTES) return ApiErrors.invalidRequest('File troppo grande (max 8 MB)');
  if (!ALLOWED_MIME.has(file.type)) return ApiErrors.invalidRequest('Formato non supportato (JPG/PNG/WEBP/PDF)');

  const admin = getAdminSupabase();

  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
  const path = `${user.id}/${kind}-${Date.now()}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const { error: upErr } = await admin.storage
    .from('kyc-docs')
    .upload(path, bytes, { contentType: file.type, upsert: false });
  if (upErr) {
    logger.error('[kyc] upload failed', upErr);
    return ApiErrors.internal('Upload fallito (bucket "kyc-docs" esiste?)');
  }

  // Mappa kind -> colonna profile
  const column: Record<string, string> = {
    id_front:        'kyc_id_doc_front_url',
    id_back:         'kyc_id_doc_back_url',
    selfie:          'kyc_selfie_url',
    rider_license:   'rider_license_url',
    rider_insurance: 'rider_insurance_url',
    rider_haccp:     'rider_haccp_url',
  };
  // Persistiamo il PATH nel bucket privato, NON una signed URL a lunga scadenza:
  // così un breach del DB non espone URL valide per 30 giorni. Le signed URL si
  // generano on-demand (start-check, review admin) con TTL breve.
  await admin
    .from('profiles')
    .update({ [column[kind]]: path })
    .eq('id', user.id);

  // URL breve (10 min) solo per l'anteprima immediata lato client, non persistita.
  const { data: signed } = await admin.storage
    .from('kyc-docs')
    .createSignedUrl(path, 60 * 10);

  return NextResponse.json({ url: signed?.signedUrl ?? null, path, kind }, { status: 200 });
});
