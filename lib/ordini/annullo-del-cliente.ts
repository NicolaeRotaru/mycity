/**
 * 5/11/2026 — Le due regole piccole dell'annullo del cliente (rotta
 * app/api/orders/[id]/cancel), tenute fuori dal file della rotta perché Next
 * accetta lì solo i metodi HTTP.
 */

// Un id che non è un UUID non è un ordine: «non trovato», non un guasto del server. PostgreSQL
// lo rifiuta con 22P02 (testo non valido per il tipo uuid); prima la rotta lo scriveva come
// errore nel registro e rispondeva 500.
export function idDiOrdineNonValido(errore: { code?: string | null } | null | undefined): boolean {
  return errore?.code === '22P02';
}

/** Il motivo vero del no, stato per stato (prima era sempre «il negozio ha già accettato»). */
export function percheNonSiAnnulla(stato: string): string {
  if (stato === 'DELIVERED') return "L'ordine è già stato consegnato: se c'è un problema apri un reso o un reclamo.";
  if (stato === 'PICKED_UP' || stato === 'OUT_FOR_DELIVERY') {
    return "L'ordine è già in consegna, non puoi più annullarlo: scrivi all'assistenza.";
  }
  return "Il negozio ha già accettato l'ordine, non puoi più annullarlo.";
}
