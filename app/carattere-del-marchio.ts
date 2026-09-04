/**
 * 3/9/2026 — L'ANTEPRIMA DEL LINK MOSTRAVA IL MARCHIO IN UN CARATTERE NON NOSTRO.
 *
 * Quando qualcuno incolla un link di MyCity in una chat, WhatsApp e Facebook
 * mostrano un'immagine di anteprima che disegniamo noi (`app/opengraph-image.tsx`).
 * Lì la scritta «MyCity» chiedeva `system-ui` a peso 900. Due cose sbagliate:
 *
 *  · a chi disegna l'immagine non veniva passato NESSUN carattere, quindi
 *    ripiegava sul suo di riserva — e il marchio usciva in un carattere che non
 *    è il nostro. Il marchio ufficiale è Fraunces: lo dichiara il file del
 *    logotipo, `docs/mockup/assets/wordmark-light.svg`, con «Fraunces, Georgia,
 *    serif» a peso 800;
 *  · il peso 900 nel prodotto non esiste: `app/layout.tsx` carica Fraunces dal
 *    400 all'800, e la scala del design si ferma a 800.
 *
 * Il file del carattere sta accanto a questo modulo perché l'immagine gira sul
 * runtime «edge», dove `node:fs` non c'è: l'unico modo di leggere un file
 * proprio è `fetch(new URL('./nome', import.meta.url))`, che il compilatore
 * trasforma in un pezzo del pacchetto. Sono 70 KB, una volta sola.
 *
 * Carattere: Fraunces ExtraBold (peso 800), licenza SIL Open Font License 1.1,
 * lo stesso che il sito già scarica da Google Fonts in `app/layout.tsx`.
 *
 * ── La regola ───────────────────────────────────────────────────────────────
 * Se il carattere non si carica NON si rinuncia all'immagine: si torna a com'era
 * prima, cioè un'anteprima nel carattere di riserva. Un logo nel carattere
 * sbagliato è un difetto; nessuna anteprima è un danno.
 *
 * E qui c'è una trappola vera. Chi disegna l'immagine sceglie così:
 *
 *     fonts: options.fonts || defaultFonts
 *
 * In JavaScript un elenco VUOTO è vero. Consegnare `[]` non vuol dire «usa il
 * tuo carattere di riserva»: vuol dire «al mondo non esiste nessun carattere»,
 * e l'immagine non viene più — cioè nessuna anteprima, che è peggio del difetto
 * che stiamo riparando. Per questo qui, quando non si legge niente, si torna
 * `undefined`: è l'unico valore che riaccende il carattere di riserva.
 *
 * (Che `fetch(new URL(…, import.meta.url))` funzioni sul runtime edge non è una
 * scommessa: è esattamente come next/og carica il proprio Noto Sans di riserva.)
 */

/** Il carattere così come lo vuole chi disegna l'immagine (`ImageResponse`). */
export type CarattereOG = {
  name: string;
  data: ArrayBuffer;
  weight: 800;
  style: 'normal';
};

/** Il nome da scrivere in `fontFamily`. */
export const MARCHIO_FONT_FAMILY = 'Fraunces';

/** Il peso del marchio: 800. Il 900 non esiste né nel carattere né nella scala del design. */
export const MARCHIO_FONT_WEIGHT = 800;

/** Dove sta il file, accanto a questo modulo. */
export const FILE_DEL_CARATTERE = new URL('./Fraunces-ExtraBold.ttf', import.meta.url);

type Lettore = (dove: URL) => Promise<ArrayBuffer>;

const leggiDalPacchetto: Lettore = (dove) => fetch(dove).then((r) => r.arrayBuffer());

/**
 * I caratteri da passare a `ImageResponse`, oppure `undefined` se il file non si
 * legge — mai un errore, e mai un elenco vuoto (vedi la trappola qui sopra).
 *
 * Il lettore si può sostituire: è così che una prova lo esegue davvero.
 */
export async function caratteriDelMarchio(
  leggi: Lettore = leggiDalPacchetto,
): Promise<CarattereOG[] | undefined> {
  try {
    const data = await leggi(FILE_DEL_CARATTERE);
    if (!data || data.byteLength === 0) return undefined;
    return [{ name: MARCHIO_FONT_FAMILY, data, weight: MARCHIO_FONT_WEIGHT, style: 'normal' }];
  } catch {
    return undefined;
  }
}
