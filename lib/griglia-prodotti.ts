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

/* ============================================================================
 * LA FILA ORIZZONTALE (le righe curate della home e delle pagine categoria)
 * ========================================================================== */

/**
 * 3/9/2026 — LA FILA DEI PRODOTTI POPOLARI CARICAVA COME GRIGLIA E POI DIVENTAVA
 * UNA RIGA: LA PAGINA SALTAVA DI OLTRE UN METRO.
 *
 * La griglia decideva DUE VOLTE che forma avere, con due domande diverse. Mentre
 * caricava chiedeva «sono una sezione?» — cioè fila **e** titolo — e in home il
 * titolo lo scrive il renderer fuori dal componente, quindi la risposta era no e
 * usciva una griglia di dodici scheletri: su un telefono sei righe, quasi un
 * metro e mezzo di pagina. A dati arrivati chiedeva solo «sono una fila?», la
 * risposta era sì, e le dodici schede si stringevano in una riga sola alta una
 * scheda. Tutto quello che stava sotto risaliva di colpo, sotto gli occhi di chi
 * stava leggendo — e chi aveva già il dito su un link toccava un'altra cosa.
 *
 * La cura non è aggiustare la domanda sbagliata: è che la domanda sia UNA, e che
 * la forma della fila sia scritta in un posto solo. Prima i due elenchi di classi
 * erano copiati in due punti del file e già divergevano (lo scheletro non aveva
 * lo scorrimento né gli agganci). Adesso chi disegna lo scheletro e chi disegna
 * le schede chiedono qui, e non possono più allontanarsi.
 */

/** Il contenitore della fila: scorre in orizzontale e sborda fino ai bordi dello schermo. */
export const CLASSI_FILA =
  `-mx-4 flex snap-x snap-mandatory ${DISTANZA_GRIGLIA} overflow-x-auto scrollbar-hide px-4 pb-2 sm:-mx-6 sm:px-6`;

/** La singola casella della fila: la stessa larghezza per lo scheletro e per la scheda vera. */
export const CLASSI_CASELLA_FILA = 'w-40 shrink-0 snap-start sm:w-44';

/**
 * Quante caselle finte disegnare mentre la fila carica.
 *
 * In una fila orizzontale il numero non cambia l'altezza della pagina — quello
 * che sta oltre il bordo destro non spinge niente in basso — quindi ne bastano
 * poche: servono a far vedere che qualcosa sta arrivando, non a tenere il posto
 * di tutte.
 */
export const CASELLE_FINTE_FILA = 6;
