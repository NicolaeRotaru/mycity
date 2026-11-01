/**
 * LA FOTO DELL'IPHONE (HEIC) DIVENTA UN JPEG PRIMA DI PARTIRE — O NON PARTE, E LO DICE.
 *
 * Il deposito accetta HEIC/HEIF (le foto dell'iPhone), ma Chrome, Firefox, Edge e i telefoni
 * Android non le sanno mostrare: salvata tale e quale, la foto la vedeva bene solo chi l'aveva
 * caricata dal suo iPhone, e i clienti vedevano un riquadro rotto. Il guasto era invisibile a
 * chi carica e visibile solo a chi compra.
 *
 * Qui la foto si converte nel browser (createImageBitmap → canvas → JPEG), che è proprio dove
 * l'HEIC arriva: Safari su iPhone/Mac sa decodificarla. Se il browser NON sa leggerla, il file
 * non parte e chi carica legge cosa fare: meglio una foto ferma con un perché che una foto
 * «caricata» che nessuno vede.
 *
 * Nessuna libreria nuova: solo le API del browser. Usato dai quattro punti di caricamento
 * (galleria e copertina del sito, storie 24h, foto delle recensioni).
 */

export const MESSAGGIO_FOTO_HEIC = 'Questa foto è in formato HEIC: salvala come JPG e riprova.';

/** Il browser non sa decodificare la foto HEIC: il file non va caricato. */
export class FotoHeicNonLeggibile extends Error {
  constructor(options?: { cause?: unknown }) {
    super(MESSAGGIO_FOTO_HEIC);
    this.name = 'FotoHeicNonLeggibile';
    if (options && 'cause' in options) (this as { cause?: unknown }).cause = options.cause;
  }
}

const TIPI_HEIC = new Set(['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']);
/** Tipi che il browser mostra già: un nome «.heic» con uno di questi tipi non va riconvertito. */
const TIPI_GIA_MOSTRABILI = /^image\/(jpeg|png|webp|gif|avif)$/;
const QUALITA_JPEG = 0.9;

/** Vero se il file è una foto HEIC/HEIF (dal tipo o, se il tipo manca, dal nome). */
export function eFotoHeic(file: { type?: string; name?: string }): boolean {
  const tipo = String(file.type ?? '').toLowerCase();
  if (TIPI_HEIC.has(tipo)) return true;
  return !TIPI_GIA_MOSTRABILI.test(tipo) && /\.hei[cf]$/i.test(String(file.name ?? ''));
}

async function inJpeg(file: File): Promise<Blob> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    throw new Error('il browser non ha createImageBitmap');
  }
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d non disponibile');
    ctx.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', QUALITA_JPEG));
    if (!blob || blob.size === 0) throw new Error('conversione in JPEG vuota');
    return blob;
  } finally {
    bitmap.close?.();
  }
}

/**
 * Restituisce il file da caricare: invariato se non è HEIC, un JPEG (stesso nome, «.jpg») se è
 * HEIC e il browser sa leggerlo. Se non sa leggerlo lancia `FotoHeicNonLeggibile`, col
 * messaggio da mostrare a chi carica.
 */
export async function fotoProntaAlCaricamento(file: File): Promise<File> {
  if (!eFotoHeic(file)) return file;
  let blob: Blob;
  try {
    blob = await inJpeg(file);
  } catch (cause) {
    throw new FotoHeicNonLeggibile({ cause });
  }
  const base = file.name.replace(/\.[^.]*$/, '') || 'foto';
  return new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified });
}

/** Il testo da mostrare: quello HEIC se è il caso, altrimenti decide `altrimenti`. */
export function fraseSeHeic(err: unknown, altrimenti: (err: unknown) => string): string {
  return err instanceof FotoHeicNonLeggibile ? err.message : altrimenti(err);
}
