/**
 * «Carica altri» che carica ALTRI, non di nuovo tutto.
 *
 * 27/8/2026 (R070, R080) — LA FINESTRA SI ALLARGAVA INVECE DI SPOSTARSI.
 *
 * Il modo in cui era scritto: a ogni pressione si rifaceva la stessa lettura
 * con un tetto più alto — 100, poi 200, poi 300 — e si buttava via il
 * risultato di prima. Alla quarta pressione si erano scaricate mille righe per
 * mostrarne quattrocento, sulla connessione di chi guarda, e ogni pressione
 * era più lenta della precedente. Il traffico cresce col quadrato del numero di
 * pressioni.
 *
 * Qui la finestra si SPOSTA: ogni pressione chiede le sue righe e basta.
 *
 * Nota che non va saltata: `.range()` con un ordinamento non deterministico
 * (solo `created_at DESC` su una tabella che riceve inserimenti) può saltare o
 * ripetere righe fra una pagina e l'altra. Il secondo criterio d'ordine —
 * l'identificativo — serve a questo, e va messo su ogni lettura paginata.
 */

/** Quante righe si leggono per volta. Cento è quello che si guarda davvero. */
export const RIGHE_PER_PAGINA = 100;

/**
 * La finestra da chiedere al database per quella pagina (la prima è la zero).
 * `.range(da, a)` di PostgREST è inclusivo su tutti e due gli estremi.
 */
export function finestraDellaPagina(
  pagina: number,
  dimensione: number = RIGHE_PER_PAGINA,
): [number, number] {
  const p = Math.max(0, Math.trunc(pagina));
  const da = p * dimensione;
  return [da, da + dimensione - 1];
}

/**
 * C'è dell'altro da chiedere? Sì se la pagina è tornata piena: se ne sono
 * arrivate meno di quante se ne erano chieste, quella era l'ultima.
 */
export function cEUnAltraPagina(righeTornate: number, dimensione: number = RIGHE_PER_PAGINA): boolean {
  return righeTornate >= dimensione;
}

/** La pagina da chiedere dopo, o niente se sono finite. */
export function pagineSuccessiva(
  righeUltimaPagina: number,
  pagineGiaLette: number,
  dimensione: number = RIGHE_PER_PAGINA,
): number | undefined {
  return cEUnAltraPagina(righeUltimaPagina, dimensione) ? pagineGiaLette : undefined;
}

/**
 * Unisce le pagine già lette togliendo i doppioni.
 *
 * Serve per il caso che la nota qui sopra descrive: mentre si sfoglia, un
 * ordine nuovo entra in cima e sposta tutte le righe di uno. La finestra
 * successiva ripesca allora l'ultima riga di quella prima, e a schermo lo
 * stesso ordine comparirebbe due volte — con la stessa chiave, che in React è
 * anche un difetto di resa. Qui la seconda copia si scarta: meglio una riga
 * mancante (la si vede al giro dopo) che una contata due volte.
 */
export function unisciPagine<T extends { id: string }>(pagine: readonly T[][]): T[] {
  const visti = new Set<string>();
  const fuori: T[] = [];
  for (const pagina of pagine) {
    for (const riga of pagina) {
      if (visti.has(riga.id)) continue;
      visti.add(riga.id);
      fuori.push(riga);
    }
  }
  return fuori;
}
