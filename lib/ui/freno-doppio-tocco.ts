/**
 * 12/11/2026 (R02-016) — UN DOPPIO TOCCO NON È «DUE PEZZI».
 *
 * Sulla scheda prodotto, due tocchi veloci su «Aggiungi al carrello» (dalla scheda o dalla barra in
 * fondo) mettevano una riga con quantità 2 e due avvisi «aggiunto»: addToCart somma alla riga che
 * c'è. Il freno è sincrono — un ref, non uno stato di React, che fra due eventi dello stesso
 * istante non fa in tempo ad aggiornarsi — e lascia passare un'aggiunta ogni `ms`.
 */
export const FRENO_DOPPIO_TOCCO_MS = 1000;

export function creaFrenoDoppioTocco(
  ms: number = FRENO_DOPPIO_TOCCO_MS,
  adesso: () => number = Date.now,
): () => boolean {
  let ultima = -Infinity;
  return () => {
    const t = adesso();
    if (t - ultima < ms) return false;
    ultima = t;
    return true;
  };
}
