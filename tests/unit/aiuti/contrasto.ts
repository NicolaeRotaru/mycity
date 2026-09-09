/**
 * Il contrasto fra due colori, come lo calcola WCAG.
 *
 * 8/9/2026 — LA FORMULA NON VIVE PIU' QUI. Stava in questo file e, copiata a
 * mano, dentro altri file di prova: dieci copie della stessa formula, ognuna
 * con la sua soglia scritta a mano, e nessuna che il codice del sito potesse
 * CHIAMARE. E' cosi' che il difetto del verde chiaro e' rientrato dopo essere
 * stato corretto: nessuno poteva chiedere a una funzione se un accostamento si
 * legge. Adesso la formula sta in `lib/design/contrasto.ts` e qui resta solo il
 * ponte, perche' le prove che gia' la importavano da qui non si tocchino.
 *
 * Le soglie che contano:
 *  · 4,5:1 per il testo normale (WCAG 1.4.3, livello AA);
 *  · 3:1 per il testo grande e per le parti grafiche di un comando (1.4.11).
 */
export {
  daEsadecimale,
  contrasto,
  luminanzaRelativa,
  SOGLIA_TESTO,
  SOGLIA_GRAFICA,
  BIANCO,
} from '@/lib/design/contrasto';
