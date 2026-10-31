import { NextResponse } from 'next/server';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { withAuthRateLimit } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { richiestaConTetto } from '@/lib/api/corpo';
import { tipoDaiPrimiByte, ESTENSIONE_PER_TIPO } from '@/lib/upload/firma-del-file';
import { cancelloEtaServer } from '@/lib/maggiore-eta';

export const runtime = 'nodejs';

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const ALLOWED_KINDS = new Set([
  'id_front', 'id_back', 'selfie',
  'rider_license', 'rider_insurance', 'rider_haccp',
]);

/** Il tipo di documento e la colonna del profilo che ne tiene il percorso. */
const COLONNA_PER_TIPO: Record<string, string> = {
  id_front:        'kyc_id_doc_front_url',
  id_back:         'kyc_id_doc_back_url',
  selfie:          'kyc_selfie_url',
  rider_license:   'rider_license_url',
  rider_insurance: 'rider_insurance_url',
  rider_haccp:     'rider_haccp_url',
};

/**
 * Toglie un file dal secchio senza far fallire il caricamento, ma mai in
 * silenzio: il percorso finisce nel registro, perché è l'unico posto da cui
 * l'orfano si ritrova.
 */
async function togliDalSecchio(
  admin: ReturnType<typeof getAdminSupabase>,
  percorso: string,
  contesto: Record<string, unknown>,
): Promise<void> {
  try {
    const { error } = await admin.storage.from('kyc-docs').remove([percorso]);
    if (!error) return;
    logger.error('[kyc] copia del documento non tolta dal secchio', { ...contesto, percorso, err: error.message });
  } catch (e) {
    logger.error('[kyc] copia del documento non tolta dal secchio', {
      ...contesto, percorso, err: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * Upload di documento KYC in bucket privato "kyc-docs".
 *
 * - Solo l'utente autenticato puo' caricare per se' stesso.
 * - I file vanno in path `{userId}/{kind}-{timestamp}.{ext}`; ricaricare lo
 *   stesso tipo toglie la copia di prima (una sola copia per tipo).
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
  const admin = getAdminSupabase();

  /**
   * 8/9/2026 — IL DOCUMENTO DEL MINORENNE ERA GIÀ NEL NOSTRO ARCHIVIO QUANDO IL
   * CANCELLO DEI DICIOTTO ANNI SI ACCORGEVA DI LUI.
   *
   * Il controllo dell'età girava sul pulsante finale del modulo. I documenti,
   * invece, partono appena si sceglie il file: carta d'identità, retro e selfie
   * arrivavano qui, finivano nel secchio `kyc-docs`, e solo dopo il ragazzo
   * leggeva «servono 18 anni compiuti».
   *
   * Il caso vero non è chi aggira il controllo: è chi lo subisce. Da quel
   * momento conserviamo il documento d'identità di un quindicenne senza una
   * base giuridica utile — il contratto che la giustificherebbe non può
   * esistere — senza informativa dedicata ai minori e senza nessuno che lo
   * cancelli: la pulizia dell'archivio passa solo dalla chiusura dell'account,
   * che quel ragazzo non chiederà mai.
   *
   * Quindi l'ordine dei passi si rovescia: prima la data di nascita nel
   * profilo, poi i documenti. Il controllo sta **prima** della lettura del
   * corpo: di un minorenne non entra in memoria nemmeno il file.
   */
  const { data: profiloEta } = await admin
    .from('profiles')
    .select('legal_birth_date')
    .eq('id', user.id)
    .single();
  const cancello = cancelloEtaServer(profiloEta);
  if (!cancello.ok) {
    // Nel registro il motivo e chi, mai la data di nascita: è un dato di una persona.
    logger.warn('[kyc] upload rifiutato dal cancello dei 18 anni', { userId: user.id, motivo: cancello.motivo });
    return cancello.stato === 403
      ? ApiErrors.forbidden(cancello.messaggio ?? '')
      : ApiErrors.invalidRequest(cancello.messaggio ?? '');
  }

  // Tetto PRIMA di leggere il corpo. `req.formData()` legge e analizza l'intero

  // corpo in memoria: il controllo su file.size arrivava quando il file era già

  // tutto in RAM, e le route di Next non impongono un limite loro. Un solo

  // caricamento da qualche centinaio di megabyte bastava a far cadere il server.

  // #180 — Il tetto vero, non quello dichiarato da chi chiama. Prima si
  // guardava l'intestazione `content-length`: bastava ometterla per saltare il
  // controllo, e il file finiva comunque tutto in memoria.
  const richiesta = await richiestaConTetto(req, MAX_BYTES + 64 * 1024);
  if (!richiesta) return ApiErrors.payloadTooLarge('File troppo grande.');

  const form = await richiesta.formData();
  const file = form.get('file');
  const kindRaw = form.get('kind');
  const kind = typeof kindRaw === 'string' ? kindRaw : '';

  if (!ALLOWED_KINDS.has(kind)) return ApiErrors.invalidRequest('Tipo documento non valido');
  if (!(file instanceof File)) return ApiErrors.invalidRequest('File mancante');
  if (file.size > MAX_BYTES) return ApiErrors.invalidRequest('File troppo grande (max 8 MB)');
  if (!ALLOWED_MIME.has(file.type)) return ApiErrors.invalidRequest('Formato non supportato (JPG/PNG/WEBP/PDF)');

  const bytes = new Uint8Array(await file.arrayBuffer());

  /**
   * 22/8/2026 — DUE CONTROLLI SI FIDAVANO DI CHI CARICA.
   *
   * ① Il tipo del file veniva dall'intestazione che scrive il chiamante: un
   *    file qualunque presentato come `image/jpeg` passava la lista dei tipi
   *    ammessi, perché nessuno guardava i primi byte.
   *
   * ② L'estensione era «tutto quello che segue l'ultimo punto del nome»,
   *    senza lista bianca, e finiva dentro il percorso di salvataggio: il nome
   *    scelto da chi carica decideva come si chiamava il file da noi.
   *
   * Adesso la firma vera si legge dai byte, e l'estensione si ricava dal tipo
   * verificato con una mappa chiusa — come fa già lib/products/rehostImages.ts.
   */
  const tipoVero = tipoDaiPrimiByte(bytes);
  if (!tipoVero || tipoVero !== file.type) {
    return ApiErrors.invalidRequest(
      'Il file non è del formato che dichiara. Carica un JPG, PNG, WEBP o PDF vero.',
    );
  }

  const ext = ESTENSIONE_PER_TIPO[tipoVero];
  const path = `${user.id}/${kind}-${Date.now()}.${ext}`;

  /**
   * 31/10/2026 — LA FOTO MOSSA RESTAVA NEL SECCHIO PER SEMPRE.
   *
   * Ogni caricamento ha un percorso nuovo (c'è l'orario dentro) e il profilo
   * tiene solo l'ultimo. Chi ricaricava la carta d'identità perché la prima
   * foto era mossa lasciava la prima copia nel secchio senza nessun puntatore:
   * la potatura dei 90 giorni cancella solo i percorsi scritti nel profilo, e
   * l'orfano non lo trovava più nessuno (art. 5.1.e e 17 GDPR). Adesso si legge
   * il percorso di prima, e dopo l'aggiornamento del profilo quel file si toglie.
   */
  const colonna = COLONNA_PER_TIPO[kind];
  const { data: primaDiOra, error: errLettura } = await admin
    .from('profiles')
    .select(colonna)
    .eq('id', user.id)
    .single();
  if (errLettura) {
    logger.warn('[kyc] percorso precedente non letto: la copia vecchia potrebbe restare', {
      userId: user.id, kind, err: errLettura.message,
    });
  }
  const percorsoVecchio = (primaDiOra as unknown as Record<string, unknown> | null)?.[colonna];

  const { error: upErr } = await admin.storage
    .from('kyc-docs')
    .upload(path, bytes, { contentType: file.type, upsert: false });
  if (upErr) {
    logger.error('[kyc] upload failed', upErr);
    return ApiErrors.internal('Upload fallito (bucket "kyc-docs" esiste?)');
  }

  // Persistiamo il PATH nel bucket privato, NON una signed URL a lunga scadenza:
  // così un breach del DB non espone URL valide per 30 giorni. Le signed URL si
  // generano on-demand (start-check, review admin) con TTL breve.
  const { error: errProfilo } = await admin
    .from('profiles')
    .update({ [colonna]: path })
    .eq('id', user.id);
  if (errProfilo) {
    // Il profilo non punta al file appena caricato: lasciarlo nel secchio
    // vorrebbe dire un documento d'identità senza puntatore. Si toglie, e la
    // rotta non risponde «fatto» con un percorso che il profilo non ha.
    logger.error('[kyc] percorso del documento non salvato nel profilo', {
      userId: user.id, kind, err: errProfilo.message,
    });
    await togliDalSecchio(admin, path, { userId: user.id, kind, copia: 'nuova' });
    return ApiErrors.internal('Documento non salvato. Riprova.');
  }

  // Solo adesso, col profilo che punta alla copia nuova, la vecchia si toglie.
  // Solo dentro la cartella della persona: un valore di prima del cambio a
  // «percorso» (una URL firmata) o di un'altra cartella non si tocca.
  if (
    typeof percorsoVecchio === 'string' &&
    percorsoVecchio !== path &&
    percorsoVecchio.startsWith(`${user.id}/`)
  ) {
    await togliDalSecchio(admin, percorsoVecchio, { userId: user.id, kind, copia: 'vecchia' });
  }

  // URL breve (10 min) solo per l'anteprima immediata lato client, non persistita.
  const { data: signed } = await admin.storage
    .from('kyc-docs')
    .createSignedUrl(path, 60 * 10);

  return NextResponse.json({ url: signed?.signedUrl ?? null, path, kind }, { status: 200 });
});
