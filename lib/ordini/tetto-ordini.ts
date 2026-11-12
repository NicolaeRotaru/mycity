/**
 * 12/11/2026 (R10-013) — «I MIEI ORDINI» MOSTRA GLI ULTIMI CENTO, E LO DICE.
 *
 * La lettura ha un tetto esplicito (#90), e il commento diceva che il tetto era «mostrato a
 * chi guarda». Non lo era: l'intestazione scriveva «100 ordini» e gli ordini più vecchi
 * sparivano senza un avviso. Chi ne cercava uno di un anno fa credeva di averlo perso.
 * Il tetto e le parole stanno qui, cosi' la lettura e la pagina non si possono separare.
 */
export const TETTO_ORDINI = 100;

/** L'intestazione: «1 ordine», «12 ordini», oppure «ultimi 100 ordini» quando il tetto è pieno. */
export function quantiOrdini(n: number, tetto: number = TETTO_ORDINI): string {
  if (n >= tetto) return `ultimi ${tetto} ordini`;
  return n === 1 ? '1 ordine' : `${n} ordini`;
}

/** L'avviso sotto la lista, solo quando il tetto è pieno (ci possono essere ordini più vecchi). */
export function avvisoOrdiniOltreIlTetto(n: number, tetto: number = TETTO_ORDINI): string | null {
  if (n < tetto) return null;
  return `Qui vedi solo gli ultimi ${tetto} ordini. Per un ordine più vecchio scrivici dall’assistenza.`;
}
