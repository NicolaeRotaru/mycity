/**
 * I numeri della pagina «Andamento», letti dalla riga che manda il database.
 *
 * 27/8/2026 (R071) — PRIMA QUESTI NUMERI SI CONTAVANO NEL BROWSER.
 *
 * Le visite ai prodotti degli ultimi trenta giorni venivano scaricate tutte —
 * mille righe per volta, fino a un tetto duro di ventimila — e contate in
 * JavaScript. Adesso le conta il database (`andamento_del_negozio`, migrazione
 * 141) e qui si legge la riga che torna.
 *
 * La conversione non è una formalità: i `bigint` e i `numeric` di Postgres
 * arrivano spesso come TESTO. Senza `Number()` una somma diventa un
 * incollamento — «25040» + 0 fa «250400» — e il negoziante legge un numero che
 * non esiste.
 */

export type RigaAndamento = {
  viste_30: number | string | null;
  viste_7: number | string | null;
  viste_oggi: number | string | null;
  viste_per_prodotto: Record<string, number | string> | null;
  voto_medio: number | string | null;
  recensioni: number | string | null;
};

export type NumeriAndamento = {
  views30: number;
  views7: number;
  viewsToday: number;
  /** {id prodotto: visite in 30 giorni}. Chi non c'è ha zero visite. */
  viewsByProduct: Record<string, number>;
  avgRating: number;
  reviewCount: number;
};

const numero = (v: number | string | null | undefined): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export function numeriDellAndamento(riga: RigaAndamento | null | undefined): NumeriAndamento {
  const viewsByProduct: Record<string, number> = {};
  for (const [id, n] of Object.entries(riga?.viste_per_prodotto ?? {})) {
    viewsByProduct[id] = numero(n);
  }
  return {
    views30: numero(riga?.viste_30),
    views7: numero(riga?.viste_7),
    viewsToday: numero(riga?.viste_oggi),
    viewsByProduct,
    avgRating: numero(riga?.voto_medio),
    reviewCount: numero(riga?.recensioni),
  };
}
