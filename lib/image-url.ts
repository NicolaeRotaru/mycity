/**
 * Riscrive URL di immagini remote per richiedere una versione più piccola
 * appropriata al display. Senza questo aiuto Next/image è in modalità
 * "unoptimized" e scarica l'immagine alla risoluzione originale (spesso
 * 1000+px quando ne servono 240).
 *
 * Supporta:
 *  - Pexels: usa ?w= e ?h= per resize lato CDN, aggiunge auto=compress
 *  - Supabase Storage: usa la Image Transformation API (?width=&quality=)
 *  - Altri URL: invariati
 */

export type ImageSize = 'thumb' | 'card' | 'detail' | 'hero';

const SIZE_PX: Record<ImageSize, number> = {
  thumb:  100,
  card:   400,
  detail: 800,
  hero:   1200,
};

const QUALITY = 75;

function buildPexelsUrl(url: URL, sizePx: number): string {
  // Pexels accetta w, h, auto=compress, cs=tinysrgb, fit=crop
  url.searchParams.set('w', String(sizePx));
  url.searchParams.set('h', String(sizePx));
  url.searchParams.set('auto', 'compress');
  url.searchParams.set('cs', 'tinysrgb');
  url.searchParams.set('fit', 'crop');
  return url.toString();
}

function buildSupabaseStorageUrl(url: URL, sizePx: number): string {
  // Le Image Transformations Supabase si usano sostituendo /object/public/
  // con /render/image/public/ e aggiungendo ?width=&quality=
  if (url.pathname.includes('/storage/v1/object/public/')) {
    url.pathname = url.pathname.replace(
      '/storage/v1/object/public/',
      '/storage/v1/render/image/public/',
    );
  }
  url.searchParams.set('width', String(sizePx));
  url.searchParams.set('quality', String(QUALITY));
  url.searchParams.set('resize', 'cover');
  return url.toString();
}

/**
 * Restituisce un URL ottimizzato per la dimensione di display indicata.
 * Se l'URL non è riconosciuto o non parsabile, lo restituisce invariato.
 */
export function sizedImage(src: string | undefined | null, size: ImageSize): string {
  if (!src) return '';
  // Data URI / blob: già "locali"
  if (src.startsWith('data:') || src.startsWith('blob:')) return src;

  const sizePx = SIZE_PX[size];

  try {
    const url = new URL(src);
    const host = url.hostname;

    if (host === 'images.pexels.com') {
      return buildPexelsUrl(url, sizePx);
    }
    if (host.endsWith('.supabase.co')) {
      return buildSupabaseStorageUrl(url, sizePx);
    }
    // placehold.co usa il path per la dimensione, lasciamo stare
    return src;
  } catch {
    return src;
  }
}
