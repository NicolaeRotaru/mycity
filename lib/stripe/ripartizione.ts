/**
 * Ripartire uno sconto fra i gruppi di un ordine, al centesimo.
 *
 * Perché serve una funzione dedicata: al momento del pagamento lo sconto totale
 * viene limitato per non superare l'importo dell'ordine («clamp»), e quel valore
 * limitato è quello che finisce a Stripe. Le quote per singolo negozio, invece,
 * venivano calcolate sui valori NON limitati e arrotondate una per una. Due
 * conseguenze: la somma delle quote non tornava con l'importo addebitato, e nel
 * caso limitato lo scarto era grande — i totali per negozio dicevano una cosa e
 * la carta del cliente un'altra.
 *
 * Il metodo è quello del resto più grande: si assegna la parte intera a
 * ciascuno, poi i centesimi che restano vanno a chi ha il resto maggiore. La
 * somma torna sempre esatta.
 */

/**
 * Divide `totale` (centesimi) fra le voci, in proporzione ai `pesi`.
 * La somma del risultato è esattamente `totale`.
 */
export function ripartisciCentesimi(totale: number, pesi: number[]): number[] {
  const n = pesi.length;
  if (n === 0) return [];
  if (totale <= 0) return new Array<number>(n).fill(0);

  const sommaPesi = pesi.reduce((s, p) => s + Math.max(0, p), 0);
  // Nessun peso (per esempio tutti i gruppi a zero): si divide in parti uguali.
  if (sommaPesi <= 0) {
    const base = Math.floor(totale / n);
    const quote = new Array<number>(n).fill(base);
    for (let i = 0; i < totale - base * n; i++) quote[i] += 1;
    return quote;
  }

  const esatti = pesi.map((p) => (Math.max(0, p) * totale) / sommaPesi);
  const quote = esatti.map((v) => Math.floor(v));
  const assegnati = quote.reduce((s, v) => s + v, 0);

  // I centesimi rimasti vanno a chi ha il resto più grande.
  const restiOrdinati = esatti
    .map((v, i) => ({ i, resto: v - Math.floor(v) }))
    .sort((a, b) => b.resto - a.resto || a.i - b.i);

  for (let k = 0; k < totale - assegnati; k++) {
    quote[restiOrdinati[k % n].i] += 1;
  }
  return quote;
}

/**
 * Riduce due sconti (codice sconto e ritiro in negozio) al totale consentito,
 * mantenendone il rapporto. La somma dei due risultati è esattamente `tetto`.
 */
export function riduciAlTetto(
  scontoCodice: number,
  scontoRitiro: number,
  tetto: number,
): { codice: number; ritiro: number } {
  const somma = Math.max(0, scontoCodice) + Math.max(0, scontoRitiro);
  if (somma <= tetto) return { codice: Math.max(0, scontoCodice), ritiro: Math.max(0, scontoRitiro) };
  if (tetto <= 0) return { codice: 0, ritiro: 0 };

  const [codice, ritiro] = ripartisciCentesimi(tetto, [
    Math.max(0, scontoCodice),
    Math.max(0, scontoRitiro),
  ]);
  return { codice, ritiro };
}
