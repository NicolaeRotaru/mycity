import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser, getAdminSupabase } from '@/lib/supabase/server';

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
 * Salva l'URL signed (lunga durata 30 giorni) nelle colonne profile
 * corrispondenti: kyc_id_doc_front_url, kyc_id_doc_back_url,
 * kyc_selfie_url, rider_license_url, rider_insurance_url,
 * rider_haccp_url.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Autenticazione richiesta' }, { status: 401 });

  const form = await req.formData();
  const file = form.get('file');
  const kindRaw = form.get('kind');
  const kind = typeof kindRaw === 'string' ? kindRaw : '';

  if (!ALLOWED_KINDS.has(kind)) {
    return NextResponse.json({ error: 'Tipo documento non valido' }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'File mancante' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File troppo grande (max 8 MB)' }, { status: 413 });
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json({ error: 'Formato non supportato (JPG/PNG/WEBP/PDF)' }, { status: 400 });
  }

  const admin = getAdminSupabase();

  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
  const path = `${user.id}/${kind}-${Date.now()}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const { error: upErr } = await admin.storage
    .from('kyc-docs')
    .upload(path, bytes, { contentType: file.type, upsert: false });
  if (upErr) {
    console.error('[kyc] upload failed', upErr);
    return NextResponse.json({ error: 'Upload fallito (bucket "kyc-docs" esiste?)' }, { status: 500 });
  }

  const { data: signed } = await admin.storage
    .from('kyc-docs')
    .createSignedUrl(path, 60 * 60 * 24 * 30);
  const url = signed?.signedUrl ?? null;
  if (!url) return NextResponse.json({ error: 'Signed URL non disponibile' }, { status: 500 });

  // Mappa kind -> colonna profile
  const column: Record<string, string> = {
    id_front:        'kyc_id_doc_front_url',
    id_back:         'kyc_id_doc_back_url',
    selfie:          'kyc_selfie_url',
    rider_license:   'rider_license_url',
    rider_insurance: 'rider_insurance_url',
    rider_haccp:     'rider_haccp_url',
  };
  await admin
    .from('profiles')
    .update({ [column[kind]]: url })
    .eq('id', user.id);

  return NextResponse.json({ url, path, kind }, { status: 200 });
}
