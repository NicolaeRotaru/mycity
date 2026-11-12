/**
 * R06 (12/11/2026) — Un finto PostgREST col TETTO DI MILLE RIGHE.
 *
 * Il servizio dati vero non restituisce mai piu' di mille righe per richiesta
 * (max_rows), anche se gli si chiede `.limit(5000)`: risponde con le prime
 * mille e non lo tratta come un errore. Questo finto fa la stessa cosa: applica
 * i filtri, l'ordine, `.range(da, a)` e poi taglia a mille. Conta anche le
 * richieste, cosi' una prova vede quante volte si e' andati al database.
 */
export const TETTO_RIGHE = 1000;

export type Riga = Record<string, unknown>;
export type Tabelle = Record<string, Riga[]>;

type Filtro = (r: Riga) => boolean;

function confronta(a: unknown, b: unknown): number {
  const sa = String(a ?? '');
  const sb = String(b ?? '');
  return sa === sb ? 0 : sa < sb ? -1 : 1;
}

export type Richiesta = { tabella: string; finestra: [number, number] | null; tetto: number | null };

export function creaPostgrestColTetto(tabelle: Tabelle) {
  const richieste: Richiesta[] = [];

  function from(tabella: string) {
    const filtri: Filtro[] = [];
    const ordini: Array<{ colonna: string; crescente: boolean }> = [];
    let finestra: [number, number] | null = null;
    let tetto: number | null = null;
    let conteggio = false;
    let soloTesta = false;

    const q = {
      select(_colonne?: string, opzioni?: { count?: string; head?: boolean }) {
        conteggio = opzioni?.count === 'exact';
        soloTesta = !!opzioni?.head;
        return q;
      },
      eq(c: string, v: unknown) { filtri.push((r) => r[c] === v); return q; },
      neq(c: string, v: unknown) { filtri.push((r) => r[c] !== v); return q; },
      in(c: string, vs: readonly unknown[]) { filtri.push((r) => vs.includes(r[c])); return q; },
      gte(c: string, v: unknown) { filtri.push((r) => confronta(r[c], v) >= 0); return q; },
      lte(c: string, v: unknown) { filtri.push((r) => confronta(r[c], v) <= 0); return q; },
      is(c: string, v: unknown) { filtri.push((r) => (r[c] ?? null) === v); return q; },
      not() { return q; },
      order(c: string, o?: { ascending?: boolean }) { ordini.push({ colonna: c, crescente: o?.ascending !== false }); return q; },
      limit(n: number) { tetto = n; return q; },
      range(da: number, a: number) { finestra = [da, a]; return q; },
      then<T>(risolvi: (v: { data: Riga[] | null; error: null; count?: number }) => T, rifiuta?: (e: unknown) => unknown) {
        richieste.push({ tabella, finestra, tetto });
        let righe = (tabelle[tabella] ?? []).filter((r) => filtri.every((f) => f(r)));
        for (const o of [...ordini].reverse()) {
          righe = [...righe].sort((a, b) => (o.crescente ? 1 : -1) * confronta(a[o.colonna], b[o.colonna]));
        }
        const totale = righe.length;
        if (finestra) righe = righe.slice(finestra[0], finestra[1] + 1);
        if (tetto != null) righe = righe.slice(0, tetto);
        righe = righe.slice(0, TETTO_RIGHE);
        const esito = { data: soloTesta ? null : righe, error: null, ...(conteggio ? { count: totale } : {}) };
        return Promise.resolve(esito).then(risolvi, rifiuta);
      },
    };
    return q;
  }

  return {
    richieste,
    client: {
      from,
      rpc: async () => ({ data: null, error: null }),
    },
  };
}
