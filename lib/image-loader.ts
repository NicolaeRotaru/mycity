import type { ImageLoaderProps } from 'next/image';
import { sizedImage, type ImageSize } from '@/lib/image-url';

/**
 * #99 — LE FOTO RESTAVANO A 400 PIXEL SU OGNI TELEFONO, E DUE RIGHE DEL
 * next.config NON SERVIVANO A NIENTE.
 *
 * Ventinove immagini su sessantotto erano marcate `unoptimized`, e la scelta
 * aveva una logica: `sizedImage()` gira già l'indirizzo verso la
 * trasformazione immagini di Supabase, quindi il ridimensionamento lo fa il
 * loro CDN invece della CPU del server che paghiamo noi.
 *
 * Ma `unoptimized` fa una cosa in più che nessuno aveva messo per iscritto:
 * Next azzera `srcSet` E `sizes` (get-img-props.js, `generateImgAttrs`). Cioè
 * l'attributo `sizes` scritto accanto all'immagine non faceva più niente, e la
 * foto restava a 400 pixel per tutti. Su un telefono a 3× che mostra la scheda
 * a 45vw ne servirebbero circa 540: l'immagine veniva ingrandita, proprio
 * sulla scheda che deve far venire voglia di comprare.
 *
 * La strada giusta non è `unoptimized` con un `srcSet` scritto a mano — Next
 * lo cancellerebbe lo stesso — è un `loader`: Next chiede l'indirizzo per ogni
 * larghezza che gli serve, noi rispondiamo con la trasformazione Supabase a
 * quella larghezza, e il ridimensionamento resta sul loro CDN come prima. In
 * più torna a funzionare il `sizes`, che decide quale delle varianti scaricare.
 *
 * ⚠️ Le impostazioni `formats` e `minimumCacheTTL` di next.config.js valgono
 * per l'ottimizzatore interno di Next, non per queste immagini: qui il formato
 * e la cache li decide Supabase. Sta scritto anche là, così chi legge non le
 * crede attive dove non lo sono.
 */

/** Da quanti pixel in su si considera una foto «grande» (dettaglio/hero). */
const SOGLIA_DETTAGLIO = 600;
const SOGLIA_HERO = 1000;

function tagliaPerLarghezza(width: number): ImageSize {
  if (width >= SOGLIA_HERO) return 'hero';
  if (width >= SOGLIA_DETTAGLIO) return 'detail';
  if (width >= 200) return 'card';
  return 'thumb';
}

export default function caricatoreFotoRemote({ src, width }: ImageLoaderProps): string {
  // Percorsi locali (/icon.png, /placeholder.svg): non c'è niente da girare a
  // un CDN, e passarli a `sizedImage` li restituirebbe comunque invariati.
  if (!src.startsWith('http')) return src;

  // `sizedImage` conosce le regole di ogni CDN (Pexels, Supabase Storage) e la
  // scelta del ritaglio quadrato per le miniature: si riusa quella, invece di
  // riscriverla qui e farla divergere alla prima modifica.
  const conLarghezza = sizedImage(src, tagliaPerLarghezza(width));
  try {
    const url = new URL(conLarghezza);
    // La larghezza vera la decide Next, non la fascia: la fascia serve solo a
    // sapere se ritagliare quadrato e con quale qualità.
    if (url.searchParams.has('width')) url.searchParams.set('width', String(width));
    if (url.searchParams.has('w')) url.searchParams.set('w', String(width));
    if (url.searchParams.has('height')) url.searchParams.set('height', String(width));
    if (url.searchParams.has('h')) url.searchParams.set('h', String(width));
    return url.toString();
  } catch {
    return conLarghezza;
  }
}
