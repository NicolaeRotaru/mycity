import { supabase } from '@/lib/supabase/client';
import { resizeImageToFile } from '@/lib/image-resize';
import { caricaImmagine } from '@/lib/storage/carica-immagine';

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
      cacheControl: '3600',
    });
    uploaded.push(publicUrl);
  }
  return uploaded;
}
