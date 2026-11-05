/**
 * 5/11/2026 — IL TETTO DEGLI ORDINI LETTI SI DICE A CHI GUARDA.
 *
 * Guadagni e Clienti leggono al massimo gli ultimi `TETTO_ORDINI_LETTI` ordini.
 * Il commento accanto alla lettura diceva «il tetto e' mostrato a chi guarda»,
 * ma nessuna delle due pagine lo mostrava: con «Tutto» i totali sommavano solo
 * gli ultimi 500 ordini senza dirlo. Qui c'e' la frase, una sola per tutte e due.
 */
export const TETTO_ORDINI_LETTI = 500;

/** La frase da mostrare, o null se il tetto non e' stato toccato. */
export function avvisoDelTettoOrdini(righeLette: number, tetto: number = TETTO_ORDINI_LETTI): string | null {
  if (righeLette < tetto) return null;
  return `I conti qui sotto riguardano solo gli ultimi ${tetto} ordini: quelli più vecchi non sono compresi.`;
}
