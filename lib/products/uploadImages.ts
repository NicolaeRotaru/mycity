import { supabase } from '@/lib/supabase/client';

/**
 * Upload condiviso delle immagini prodotto sul bucket pubblico `products`.
 * Estratto da ProductImagesField per essere riusato anche da "Compila con una
 * foto" (le stesse foto analizzate dall'AI diventano immagini del prodotto).
 *
 * Ritorna gli URL pubblici. Lancia (friendlyError lato chiamante) su file
 * troppo grandi / formato non valido / errore storage.
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
  for (const file of files) {
    if (file.size > MAX_BYTES) throw new Error(`File "${file.name}" troppo grande (max 5 MB)`);
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) throw new Error(`Formato non valido per "${file.name}"`);
    const safeName = file.name.toLowerCase().replace(/[^a-z0-9.\-_]/g, '_').slice(-80);
    const ext = file.type.split('/')[1];
    const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName || `img.${ext}`}`;
    const { error: upErr } = await supabase.storage.from('products').upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type,
    });
    if (upErr) throw upErr;
    const { data } = supabase.storage.from('products').getPublicUrl(path);
    uploaded.push(data.publicUrl);
  }
  return uploaded;
}
