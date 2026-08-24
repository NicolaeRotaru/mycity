/**
 * Le classi della griglia dei prodotti, in UN posto solo.
 *
 * IL DIFETTO CHE CHIUDE. Lo scheletro del caricamento e la griglia vera avevano due elenchi di
 * colonne scritti a mano, in due file diversi. Non coincidevano: lo scheletro si fermava a quattro
 * colonne, la griglia vera su schermo grande ne fa sei. Così, appena arrivavano i prodotti, la
 * pagina si riorganizzava tutta — da quattro colonne a sei — sotto gli occhi di chi stava leggendo.
 *
 * Uno scheletro serve a UNA cosa: tenere il posto della forma che sta per arrivare. Se ha una forma
 * diversa non tiene il posto, lo sposta — ed è peggio di non averlo, perché promette una pagina e
 * ne consegna un'altra.
 *
 * Con una funzione sola le due forme non possono più divergere: chi disegna lo scheletro e chi
 * disegna la griglia chiedono la stessa cosa allo stesso posto.
 */

/** Il distanziamento fra le schede. Anche questo era scritto due volte, e diverso: gap-4 e gap-3. */
export const DISTANZA_GRIGLIA = 'gap-3';

/** Quante colonne al massimo: `4` sulle pagine collezione/categoria, `'default'` (o niente) per la scala piena. */
export type ColonneMassime = 'default' | 4;

/**
 * @param maxColumns 4 sulle pagine collezione/categoria (meno dense), altrimenti la scala piena.
 */
export function classiGriglia(maxColumns?: ColonneMassime): string {
  const colonne =
    maxColumns === 4
      ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4'
      : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6';
  return `grid ${colonne} ${DISTANZA_GRIGLIA}`;
}

/**
 * La proporzione del riquadro-foto di una scheda prodotto.
 *
 * Lo scheletro usava un'altezza fissa (`h-48`, 192 punti) e la scheda vera un quadrato: su un
 * telefono a due colonne il quadrato è alto quanto è largo — circa 180 — e su uno schermo grande a
 * sei colonne circa 200. Non coincideva quasi mai, e ogni volta la pagina saltava.
 */
export const PROPORZIONE_FOTO = 'aspect-square';
