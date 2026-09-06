import { supabase } from '@/lib/supabase/client';
import { resizeImageToFile } from '@/lib/image-resize';
import { ANNO_IN_SECONDI, caricaImmagine } from '@/lib/storage/carica-immagine';

/**
 * Upload condiviso delle immagini prodotto sul bucket pubblico `products`.
 * Estratto da ProductImagesField per essere riusato anche da "Compila con una
 * foto" (le stesse foto analizzate dall'AI diventano immagini del prodotto).
 *
 * Ritorna gli URL pubblici. Lancia (friendlyError lato chiamante) su formato
 * non valido / errore storage. Le foto oltre i 5 MB (tipiche degli smartphone)
 * non vengono piu' rifiutate: le ricomprimiamo lato client prima dell'upload.
 */

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * LA FOTO TROPPO PICCOLA, DETTA PRIMA CHE LA VEDA IL CLIENTE.
 *
 * Il controllo sulle foto esisteva solo verso l'alto: si rifiuta cio' che supera
 * i 30 MB (ProductImagesField) e si ricomprime cio' che supera i 5 (qui sotto).
 * Verso il basso non c'era niente. Un negoziante che salva dal suo vecchio sito
 * una foto da 300 pixel la carica senza un avviso, e quella foto finisce sulla
 * scheda prodotto dentro un riquadro che sul computer arriva a 220 pixel e su
 * telefono occupa quasi meta' larghezza: sgranata proprio nel punto che deve
 * far comprare. Se ne accorge solo se va a guardarsi la pagina da cliente.
 *
 * E' un AVVISO, non un blocco: una foto piccola vale piu' di nessuna foto, e un
 * negozio che non riesce a pubblicare e' un negozio che smette.
 *
 * Torna i NOMI delle foto sotto la soglia. Se non c'e' modo di misurarle — il
 * browser non ha `createImageBitmap`, il file non si apre, gira sul server —
 * torna un elenco vuoto: un avviso mancato non fa danno, un avviso sbagliato si'.
 */
export const LATO_MINIMO_CONSIGLIATO = 800;

export async function fotoTroppoPiccole(files: File[]): Promise<string[]> {
  if (typeof createImageBitmap !== 'function') return [];
  const piccole: string[] = [];
  for (const file of files) {
    try {
      const bitmap = await createImageBitmap(file);
      const latoLungo = Math.max(bitmap.width, bitmap.height);
      bitmap.close?.();
      if (latoLungo > 0 && latoLungo < LATO_MINIMO_CONSIGLIATO) piccole.push(file.name);
    } catch {
      // Non misurabile: si tace. Il caricamento non deve dipendere da un avviso.
    }
  }
  return piccole;
}

export async function uploadProductImages(files: File[]): Promise<string[]> {
  if (files.length === 0) return [];
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Non autenticato');

  const uploaded: string[] = [];
  for (const original of files) {
    if (!ALLOWED_IMAGE_TYPES.includes(original.type)) {
      throw new Error(`Formato non valido per "${original.name}"`);
    }

    // Le foto da smartphone superano spesso i 5 MB: invece di rifiutarle,
    // le ricomprimiamo (JPEG) finche' rientrano nel limite del bucket.
    let file = original;
    if (file.size > MAX_BYTES) {
      file = await resizeImageToFile(original, 1600, 0.85);
      if (file.size > MAX_BYTES) file = await resizeImageToFile(original, 1280, 0.7);
    }

    const safeName = file.name.toLowerCase().replace(/[^a-z0-9.\-_]/g, '_').slice(-80);
    const { publicUrl } = await caricaImmagine(supabase, {
      file,
      userId: user.id,
      etichetta: safeName,
      cacheControl: ANNO_IN_SECONDI,
    });
    uploaded.push(publicUrl);
  }
  return uploaded;
}
