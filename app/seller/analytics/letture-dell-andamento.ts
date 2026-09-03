/**
 * LE DUE LETTURE DELLA PAGINA «ANALISI», TENUTE SEPARATE.
 *
 * 3/9/2026 — UNA FUNZIONE MANCANTE NEL DATABASE SPEGNEVA ANCHE IL FATTURATO.
 *
 * La pagina fa due letture indipendenti: gli ORDINI (da cui escono fatturato,
 * numero di ordini, giornate e ore di punta) e le VISITE con il voto medio, che
 * le conta il database con `andamento_del_negozio` (migrazione 141). In
 * produzione quella funzione non c'è ancora: la lettura torna un errore, e il
 * codice — giustamente, dopo #217 — non lo nascondeva più. Solo che le buttava
 * insieme: `andamentoRes.error ?? ordersRes.error`, un errore solo, e tutta la
 * pagina diventava una schermata di guasto.
 *
 * Il negoziante apriva i suoi numeri e non vedeva NIENTE — nemmeno i soldi, che
 * erano stati letti bene. È la pagina con cui decide se fidarsi di noi.
 *
 * Le due letture non hanno lo stesso peso. Senza gli ordini non c'è pagina: si
 * ferma e lo dice. Senza le visite c'è ancora quasi tutto, e quello che manca si
 * dichiara «non lo so» — mai zero. Uno zero, qui, è una bugia che si legge come
 * «nessuno guarda i tuoi prodotti»: sulla stessa schermata che consiglia di
 * abbassare i prezzi.
 *
 * 🟢 Pure: nessuna rete, nessun database. Una prova le ESEGUE.
 */

export type EsitoDelleLetture = {
  /** Vero quando non resta niente di vero da mostrare: la pagina si ferma. */
  fermati: boolean;
  /** L'errore da far risalire quando ci si ferma (altrimenti null). */
  errore: unknown;
  /** Vero quando visite e voto non si sanno: si scrivono «—», non «0». */
  visiteIgnote: boolean;
};

export function letturaDellAndamento(erroreOrdini: unknown, erroreVisite: unknown): EsitoDelleLetture {
  if (erroreOrdini) return { fermati: true, errore: erroreOrdini, visiteIgnote: true };
  if (erroreVisite) return { fermati: false, errore: null, visiteIgnote: true };
  return { fermati: false, errore: null, visiteIgnote: false };
}

/**
 * Ordini ogni cento visite. Torna `null` — non zero — quando la divisione non
 * si può fare: senza le visite non c'è tasso, e senza NESSUNA visita misurata
 * un negozio che ha venduto tre volte non ha convertito «lo 0,0%».
 */
export function tassoDiConversione(ordini: number, visite: number | null): number | null {
  if (visite == null || visite <= 0) return null;
  return (ordini / visite) * 100;
}

/** Un numero che si sa, o il trattino che dice «questo non lo so». */
export function numeroOTrattino(n: number | null): string {
  return n == null ? '—' : String(n);
}
