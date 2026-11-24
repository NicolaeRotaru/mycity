/**
 * Il finto di react-query deve saper fare `setQueriesData`, come quello vero.
 *
 * Una pagina (per esempio le notifiche, dopo «Segna tutte come lette») aggiorna in memoria TUTTE le
 * domande che corrispondono a un filtro (`queryKey` come prefisso, più un `predicate` facoltativo).
 * Con il finto senza quel metodo la pagina cadeva lì: nessuna domanda si aggiornava, e una prova non
 * poteva vedere cosa la pagina scrive in memoria. Qui la prova accende la memoria del finto con
 * `globalThis.__CACHE_QUERY__` (una Map), lascia servire alcune domande da `useQuery`, chiama
 * `setQueriesData` e guarda cosa è cambiato: solo le domande corrispondenti, col dato nuovo, e il
 * ritorno `[queryKey, dato][]` come nell'API vera.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

type Filtro = { queryKey?: unknown[]; exact?: boolean; predicate?: (q: { queryKey: unknown[] }) => boolean };
type Aggiorna = unknown | ((prima: unknown) => unknown);
type Client = {
  setQueriesData?: (filtro: Filtro, aggiorna: Aggiorna) => Array<[unknown[], unknown]>;
};
type Finto = {
  useQuery: (o: { queryKey: unknown[] }) => { data: unknown };
  useQueryClient: () => Client;
};

const g = globalThis as unknown as Record<string, unknown>;

const DATI: Record<string, unknown> = {
  '["notifications","list","u1"]': [{ id: 1, is_read: false }, { id: 2, is_read: false }],
  '["notifications","list","u1",{"pagina":2}]': [{ id: 3, is_read: false }],
  '["notifications","list","u2"]': [{ id: 9, is_read: false }],
  '["notifications","count","u1"]': 3,
  '["orders","u1"]': ['o1'],
};

/** Senza il metodo nessuna domanda si aggiorna: è proprio il difetto, letto come risultato. */
function chiama(qc: Client, filtro: Filtro, aggiorna: Aggiorna) {
  return qc.setQueriesData ? qc.setQueriesData(filtro, aggiorna) : [];
}

async function preparaMemoria(): Promise<Finto> {
  const finto = (await import('./aiuti/finti/react-query.mjs')) as unknown as Finto;
  for (const chiave of Object.keys(DATI)) finto.useQuery({ queryKey: JSON.parse(chiave) });
  return finto;
}

describe('finto di react-query: setQueriesData aggiorna tutte le domande che corrispondono al filtro', () => {
  beforeEach(() => {
    g.__CACHE_QUERY__ = new Map();
    g.__CACHE_SCRITTA__ = [];
    g.__DATI_QUERY__ = (o: { queryKey: unknown[] }) => DATI[JSON.stringify(o.queryKey)];
  });
  afterEach(() => {
    for (const k of ['__CACHE_QUERY__', '__CACHE_SCRITTA__', '__DATI_QUERY__']) delete g[k];
  });

  it('prefisso + predicate: aggiorna solo gli elenchi di u1 e ritorna [queryKey, dato][]', async () => {
    const finto = await preparaMemoria();
    const qc = finto.useQueryClient();
    const ritorno = chiama(
      qc,
      { queryKey: ['notifications', 'list'], predicate: (q) => q.queryKey.at(-1) === 'u1' || q.queryKey.at(-2) === 'u1' },
      (prima: unknown) => (prima as { id: number; is_read: boolean }[] | undefined)?.map((n) => ({ ...n, is_read: true })),
    );
    expect(ritorno).toEqual([
      [['notifications', 'list', 'u1'], [{ id: 1, is_read: true }, { id: 2, is_read: true }]],
      [['notifications', 'list', 'u1', { pagina: 2 }], [{ id: 3, is_read: true }]],
    ]);
    // In memoria: cambiate le due di u1, intatte quella di u2, il conto e gli ordini.
    const memoria = g.__CACHE_QUERY__ as Map<string, { queryKey: unknown[]; data: unknown }>;
    expect(memoria.get('["notifications","list","u1"]')?.data).toEqual([{ id: 1, is_read: true }, { id: 2, is_read: true }]);
    expect(memoria.get('["notifications","list","u2"]')?.data).toEqual([{ id: 9, is_read: false }]);
    expect(memoria.get('["notifications","count","u1"]')?.data).toBe(3);
    // E la prova che ascolta le scritture le vede, una per domanda.
    expect(g.__CACHE_SCRITTA__).toEqual(ritorno);
  });

  it('un valore (non una funzione) e il filtro exact: solo quella domanda', async () => {
    const finto = await preparaMemoria();
    const ritorno = chiama(finto.useQueryClient(), { queryKey: ['notifications', 'count', 'u1'], exact: true }, 0);
    expect(ritorno).toEqual([[['notifications', 'count', 'u1'], 0]]);
    expect((g.__CACHE_QUERY__ as Map<string, { data: unknown }>).get('["notifications","count","u1"]')?.data).toBe(0);
  });

  it('se la funzione ritorna undefined la domanda resta com\'era (ritorno [queryKey, undefined])', async () => {
    const finto = await preparaMemoria();
    const ritorno = chiama(finto.useQueryClient(), { queryKey: ['orders'] }, () => undefined);
    expect(ritorno).toEqual([[['orders', 'u1'], undefined]]);
    expect((g.__CACHE_QUERY__ as Map<string, { data: unknown }>).get('["orders","u1"]')?.data).toEqual(['o1']);
    expect(g.__CACHE_SCRITTA__).toEqual([]);
  });
});
