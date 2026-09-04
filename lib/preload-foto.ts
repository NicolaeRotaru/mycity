import caricatoreFotoRemote from '@/lib/image-loader';

/**
 * IL PRECARICO DELLA FOTO GRANDE — e perché la stessa foto si scaricava due volte.
 *
 * ── Il difetto ──────────────────────────────────────────────────────────────────────────────
 * Il guscio della scheda prodotto (`app/product/[id]/layout.tsx`, che gira sul server) scriveva
 * nell'HTML un `<link rel="preload" as="image">` con l'indirizzo di `sizedImage(foto, 'detail')`,
 * cioè una foto da 800 pixel. Il commento accanto diceva «l'indirizzo è lo STESSO che chiederà la
 * pagina»: non era più vero da quando la pagina è passata a un `loader`.
 *
 * Con un `loader`, la larghezza la sceglie Next da una lista fissa — 640, 750, 828, 1080, 1200,
 * 1920, 2048, 3840, più le misure piccole — e 800 in quella lista non c'è. Quindi il telefono
 * scaricava il file da 800 pixel del precarico E POI il candidato vero del `srcSet` (750 o 828):
 * due foto di prodotto invece di una, nel momento esatto che decide se la pagina sembra veloce.
 *
 * ── La cura ─────────────────────────────────────────────────────────────────────────────────
 * Il precarico non prova più a indovinare l'indirizzo: lo costruisce con LO STESSO caricatore e LO
 * STESSO `sizes` dell'immagine in pagina, e mette nell'HTML anche `imagesrcset`/`imagesizes`. Così
 * il browser sceglie fra gli stessi candidati e riusa il file che ha già cominciato a scaricare.
 * La stringa `sizes` vive qui, in un posto solo: pagina e guscio la leggono da qui, e non possono
 * più separarsi.
 *
 * 🟢 Pura: nessuna rete. Una prova la ESEGUE e pretende che l'indirizzo precaricato sia uno dei
 * candidati che la pagina può davvero chiedere.
 */

/**
 * Le larghezze che Next può chiedere, con le impostazioni predefinite.
 *
 * ⚠️ È una COPIA dei valori predefiniti di Next, perché `next.config.js` non li dichiara. Se un
 * giorno qualcuno ci scrive `images.deviceSizes` o `images.imageSizes`, questa copia diventa
 * vecchia e il precarico ricomincia a puntare a una misura che nessuno chiederà: per questo la
 * prova legge `next.config.js` e diventa rossa se quelle chiavi compaiono.
 */
export const LARGHEZZE_SCHERMO = [640, 750, 828, 1080, 1200, 1920, 2048, 3840];
export const LARGHEZZE_RIQUADRO = [16, 32, 48, 64, 96, 128, 256, 384];
const TUTTE = [...LARGHEZZE_RIQUADRO, ...LARGHEZZE_SCHERMO].sort((a, b) => a - b);

/**
 * Quali larghezze finiscono nel `srcSet`, data la stringa `sizes` — la stessa regola di Next
 * (`getWidths` in `get-img-props`): se `sizes` contiene una percentuale di schermo si tiene la più
 * piccola come rapporto e si scartano le misure sotto quella soglia; altrimenti si tengono tutte.
 */
export function larghezzeCandidate(sizes: string): number[] {
  const percentuali = [...sizes.matchAll(/(^|\s)(1?\d?\d)vw/g)].map((m) => Number(m[2]));
  if (percentuali.length === 0) return TUTTE;
  const rapportoMinimo = Math.min(...percentuali) * 0.01;
  return TUTTE.filter((s) => s >= LARGHEZZE_SCHERMO[0] * rapportoMinimo);
}

/**
 * Quanto è larga a schermo la foto grande della scheda prodotto. Una stringa sola per la pagina e
 * per il precarico: se si separano, il browser scarica due file al posto di uno.
 */
export const SIZES_FOTO_PRODOTTO = '(min-width: 1024px) 480px, (min-width: 640px) 50vw, 100vw';

export interface PrecaricoFoto {
  href: string;
  imageSrcSet: string;
  imageSizes: string;
}

/** Gli attributi del `<link rel="preload">`, costruiti come li costruirebbe l'immagine in pagina. */
export function precaricoFoto(src: string, sizes: string = SIZES_FOTO_PRODOTTO): PrecaricoFoto {
  const larghezze = larghezzeCandidate(sizes);
  return {
    // Come Next: l'attributo `src` porta il candidato più grande, e serve solo ai browser che non
    // sanno leggere `imagesrcset`. Gli altri scelgono dal set qui sotto, con la stessa regola.
    href: caricatoreFotoRemote({ src, width: larghezze[larghezze.length - 1] }),
    imageSrcSet: larghezze.map((w) => `${caricatoreFotoRemote({ src, width: w })} ${w}w`).join(', '),
    imageSizes: sizes,
  };
}
