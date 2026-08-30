/**
 * QUANTO SI ASPETTA IL BONIFICO AL NEGOZIO — SCRITTO IN UN POSTO SOLO.
 *
 * 27/8/2026 (R051). Lo stesso numero era scritto in quattro modi diversi, e
 * nessuno era d'accordo con gli altri:
 *
 *  · il giro dei bonifici pagava a consegna + 1 ora;
 *  · la pagina Guadagni diceva «~24 ore dopo la consegna»;
 *  · due commenti nei file dei soldi dicevano «+3gg»;
 *  · le domande frequenti del venditore dicevano «bonifico mensile il giorno 5».
 *
 * Il tempo del bonifico è la promessa su cui un negozio decide se restare.
 * Averla scritta in quattro modi vuol dire che nessuno sa quale sia quella
 * vera — e la versione VERA è anche la migliore delle quattro: paghiamo entro
 * un'ora dalla consegna, non in tre giorni e non il 5 del mese. Era il
 * vantaggio più forte che abbiamo verso i negozi, ed era l'unico che non
 * dicevamo.
 *
 * Da qui in avanti il numero è uno: chi paga e chi lo racconta leggono la
 * stessa riga.
 */

/** Ore fra la consegna e il momento in cui il bonifico al negozio parte. */
export const ORE_ATTESA_BONIFICO = 1;

/**
 * La stessa attesa detta a parole, per le pagine che la mostrano al
 * negoziante. Nasce dal numero qui sopra apposta: cambiando l'uno cambia
 * l'altra, e non possono più raccontare due cose diverse.
 */
export function fraseAttesaBonifico(): string {
  if (ORE_ATTESA_BONIFICO === 1) return "circa un'ora dopo la consegna";
  if (ORE_ATTESA_BONIFICO < 24) return `circa ${ORE_ATTESA_BONIFICO} ore dopo la consegna`;
  const giorni = Math.round(ORE_ATTESA_BONIFICO / 24);
  return giorni === 1 ? 'circa un giorno dopo la consegna' : `circa ${giorni} giorni dopo la consegna`;
}
