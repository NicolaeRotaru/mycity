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

/**
 * ⚠️ IL DIFETTO CHE QUESTI NOMI PORTAVANO DENTRO, misurato il 24/8.
 *
 * Un nome non dice quanto è grande il riquadro. Chi scriveva `sizedImage(foto, 'thumb')` intendeva
 * «è una miniatura», e si ritrovava 100 pixel — anche quando il riquadro sullo schermo ne era largo
 * 768. La foto veniva stirata di sette volte e mezzo: sgranata, ma «ottimizzata».
 *
 * Misurato sul sito vero: su 36 punti in cui si può confrontare la richiesta col riquadro
 * dichiarato (`sizes="…px"`), **15 chiedevano una foto più piccola del riquadro**. Il peggiore era
 * quel 7,7×; quattro erano oltre il doppio.
 *
 * Per questo `sizedImage` accetta anche un NUMERO — la larghezza vera del riquadro in pixel. Con un
 * numero la richiesta non può essere più piccola del riquadro, perché è il riquadro. I quattro nomi
 * restano per i punti in cui il riquadro non è dichiarato, e una prova di struttura tiene il conto
 * di chi chiede meno di quanto mostra: `tests/unit/la-foto-chiesta-piu-piccola-del-riquadro.test.ts`.
 */
const SIZE_PX: Record<ImageSize, number> = {
  thumb:  100,
  card:   400,
  detail: 800,
  hero:   1200,
};

/** La larghezza più grande che ha senso chiedere: oltre, si scarica roba che nessuno vede. */
export const LARGHEZZA_MASSIMA = 1600;

/**
 * Legge l'attributo `sizes` come lo leggerebbe un browser, e dice quanto è largo il riquadro.
 *
 * ⚠️ SBAGLIARE QUESTA LETTURA È FACILE, e l'ho sbagliata scrivendo questo stesso lavoro. `sizes` è
 * un elenco di clausole «(condizione) valore»: in `(min-width: 768px) 160px, 50vw` il 768 è la
 * SOGLIA dello schermo e il 160 è il riquadro. Prendendo il numero più grande — come avevo fatto —
 * il riquadro risultava 768 invece di 160, e la cura avrebbe fatto scaricare foto quasi cinque
 * volte più grandi del necessario: il difetto opposto a quello che stavo curando.
 *
 * @returns px = la larghezza fissa più grande dichiarata, o `null` se il riquadro è espresso solo in
 *          percentuale di schermo (`vw`). `null` vuol dire «non lo so», e non si arrotonda a un
 *          numero comodo: un riquadro in `vw` cresce con lo schermo e non ha una larghezza sola.
 */
export function riquadroDichiarato(sizes: string): { px: number | null; inVw: number } {
  let px: number | null = null;
  let inVw = 0;
  for (const clausola of String(sizes).split(',')) {
    // Il valore è quello che resta tolte le condizioni fra parentesi.
    const valore = clausola.replace(/\([^)]*\)/g, '').trim();
    const fisso = valore.match(/^(\d+(?:\.\d+)?)px$/);
    if (fisso) px = Math.max(px ?? 0, Number(fisso[1]));
    else if (/\d+(?:\.\d+)?vw$/.test(valore)) inVw += 1;
  }
  return { px, inVw };
}

/** I nomi che chiedono anche un ritaglio quadrato, per riempire i riquadri `aspect-square`. */
const NOMI_QUADRATI: ImageSize[] = ['thumb', 'card'];

export function pixelDellaTaglia(size: ImageSize): number {
  return SIZE_PX[size];
}

const QUALITY = 75;

function buildPexelsUrl(url: URL, sizePx: number, ritaglia: boolean): string {
  // Pexels accetta w, h, auto=compress, cs=tinysrgb, fit=crop
  url.searchParams.set('w', String(sizePx));
  // Il ritaglio quadrato resta l'impostazione di fabbrica — su Pexels ci sono
  // foto, e una foto si può tagliare. Si spegne solo se chi chiama DICHIARA
  // `quadrato: false`, cioè quando sa che quella non è una foto ma un marchio
  // con dentro una scritta: `logoNegozio` è l'unico posto che lo fa.
  if (ritaglia) {
    url.searchParams.set('h', String(sizePx));
    url.searchParams.set('fit', 'crop');
  }
  url.searchParams.set('auto', 'compress');
  url.searchParams.set('cs', 'tinysrgb');
  return url.toString();
}

function buildSupabaseStorageUrl(url: URL, sizePx: number, square: boolean): string {
  // Le Image Transformations Supabase si usano sostituendo /object/public/
  // con /render/image/public/ e aggiungendo ?width=&quality=
  if (url.pathname.includes('/storage/v1/object/public/')) {
    url.pathname = url.pathname.replace(
      '/storage/v1/object/public/',
      '/storage/v1/render/image/public/',
    );
  }
  url.searchParams.set('width', String(sizePx));
  // Per le viste a griglia (thumb/card) forziamo un ritaglio QUADRATO, come
  // fanno le foto demo Pexels (fit=crop): così le foto caricate dai negozi
  // riempiono il riquadro aspect-square senza bande/letterbox. Per detail/hero
  // NON impostiamo l'altezza, per mostrare l'intero prodotto nel dettaglio.
  if (square) url.searchParams.set('height', String(sizePx));
  url.searchParams.set('quality', String(QUALITY));
  url.searchParams.set('resize', 'cover');
  return url.toString();
}

/**
 * Restituisce un URL ottimizzato per il riquadro in cui la foto verrà mostrata.
 *
 * @param size  o uno dei quattro nomi, o la LARGHEZZA VERA del riquadro in pixel. Il numero è la
 *              forma da preferire dove il riquadro si conosce: un numero non può mentire sulla
 *              dimensione, un nome sì — ed è così che una foto da 100 pixel finiva dentro un
 *              riquadro da 768.
 * @param opzioni.quadrato  forza (o vieta) il ritaglio quadrato. Senza, lo decide il nome: `thumb` e
 *              `card` ritagliano, `detail` e `hero` no. Con un numero il ritaglio è spento salvo
 *              richiesta esplicita — perché la larghezza di un riquadro non dice niente sulla sua
 *              forma, e un logo con la scritta ritagliato a quadrato diventa illeggibile.
 */
export function sizedImage(
  src: string | undefined | null,
  size: ImageSize | number,
  opzioni: { quadrato?: boolean } = {},
): string {
  if (!src) return '';
  // Data URI / blob: già "locali"
  if (src.startsWith('data:') || src.startsWith('blob:')) return src;

  const perNome = typeof size === 'string';
  // Un riquadro largo mezzo pixel non esiste, e uno da diecimila non serve a nessuno: si arrotonda
  // e si tiene dentro i limiti, senza mai scendere sotto quello che è stato chiesto.
  const sizePx = perNome
    ? SIZE_PX[size]
    : Math.min(LARGHEZZA_MASSIMA, Math.max(1, Math.ceil(size)));
  // Col nome il ritaglio resta com'era; col numero è spento salvo richiesta, perché la larghezza
  // non dice niente sulla forma del riquadro.
  const square = opzioni.quadrato ?? (perNome ? NOMI_QUADRATI.includes(size) : false);

  try {
    const url = new URL(src);
    const host = url.hostname;

    if (host === 'images.pexels.com') {
      return buildPexelsUrl(url, sizePx, opzioni.quadrato !== false);
    }
    if (host.endsWith('.supabase.co')) {
      return buildSupabaseStorageUrl(url, sizePx, square);
    }
    // placehold.co usa il path per la dimensione, lasciamo stare
    return src;
  } catch {
    return src;
  }
}

/**
 * L'indirizzo di un LOGO di negozio. Non ritaglia mai.
 *
 * 3/9/2026 — I MARCHI CON LA SCRITTA DIVENTAVANO ILLEGGIBILI.
 *
 * Il taglio non lo faceva il cerchio del CSS: lo faceva il server. Per le
 * misure `thumb` e `card` l'indirizzo viene riscritto con `height` uguale a
 * `width` e `resize=cover`, cioè il CDN tiene solo il quadrato centrale.
 * Su un marchio da 1000×300 — la forma normale di un logo con scritto sopra il
 * nome — restavano i 300 pixel centrali: si leggeva un pezzo di parola. E il
 * negoziante non poteva farci niente, perché al caricamento non gli viene
 * chiesto nessun ritaglio: carica il suo marchio e lo ritrova mozzato ovunque.
 *
 * Un logo non è una foto di prodotto: la foto si può tagliare, il nome del
 * negozio no. Qui si chiede solo la larghezza — senza `height` il server
 * rimpicciolisce e basta — e chi mostra il logo lo mette dentro il cerchio con
 * `object-contain`, non `object-cover`.
 *
 * @param larghezzaBoxPx la larghezza VERA del cerchio sullo schermo, in pixel.
 *        Chiediamo il doppio perché sui telefoni un pixel dello schermo sono
 *        due (o tre) pixel veri: chiedendone quaranta per un cerchio da
 *        quaranta il marchio si vedrebbe sfocato.
 */
export function logoNegozio(src: string | undefined | null, larghezzaBoxPx: number): string {
  return sizedImage(src, Math.max(1, Math.round(larghezzaBoxPx)) * 2, { quadrato: false });
}
