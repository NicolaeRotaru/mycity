import { afterEach, describe, expect, it } from 'vitest';
import { supabase } from './aiuti/finti/supabase-client.mjs';

/**
 * 17/11/2026 — Nel client Supabase finto delle prove, gli anelli dopo una funzione del database
 * (`.rpc(...).order(...).range(...)`) devono arrivare al database della prova, come arrivano quelli
 * dopo `from`. Prima la catena non scoppiava più, ma gli anelli si perdevano per strada: una
 * funzione che taglia e ordina non ne vedeva nessuno e restituiva tutte le righe, e una prova non
 * poteva controllare quale finestra la pagina aveva chiesto.
 */
type Esito = { data: unknown; error: unknown };
type Anello = PromiseLike<Esito> & {
  order: (...a: unknown[]) => Anello;
  range: (...a: unknown[]) => Anello;
  eq: (...a: unknown[]) => Anello;
  single: () => Promise<Esito>;
};
const rpc = supabase.rpc as unknown as (nome: string, argomenti?: Record<string, unknown>) => Anello;

type Riga = { n: number; negozio: string };
const RIGHE: Riga[] = [
  { n: 3, negozio: 'a' },
  { n: 1, negozio: 'b' },
  { n: 5, negozio: 'a' },
  { n: 2, negozio: 'a' },
  { n: 4, negozio: 'b' },
];

/** Un database della prova la cui funzione risponde con una catena vera: registra gli anelli e li applica. */
function databaseCheTaglia() {
  const anelli: unknown[][] = [];
  const rpcFinta = (nome: string) => {
    let righe = [...RIGHE];
    const b = {
      eq: (col: keyof Riga, v: unknown) => { anelli.push(['eq', col, v]); righe = righe.filter((r) => r[col] === v); return b; },
      order: (col: keyof Riga, o?: { ascending?: boolean }) => {
        anelli.push(['order', col, o]);
        const verso = o?.ascending === false ? -1 : 1;
        righe = [...righe].sort((x, y) => (x[col] > y[col] ? verso : -verso));
        return b;
      },
      range: (da: number, a: number) => { anelli.push(['range', da, a]); righe = righe.slice(da, a + 1); return b; },
      single: async () => { anelli.push(['single']); return { data: { nome, prima: righe[0] ?? null }, error: null }; },
      then: (ok: (e: Esito) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve({ data: righe, error: null }).then(ok, ko),
    };
    return b;
  };
  return { anelli, client: { from: () => ({}), rpc: rpcFinta } };
}

const g = globalThis as { __CLIENT_SUPABASE__?: unknown };
afterEach(() => {
  delete g.__CLIENT_SUPABASE__;
});

describe('il client finto: gli anelli dopo .rpc() arrivano al database della prova', () => {
  it('order e range arrivano, nell’ordine, e la risposta è la finestra chiesta', async () => {
    const db = databaseCheTaglia();
    g.__CLIENT_SUPABASE__ = db.client;
    const esito = await rpc('prodotti_del_negozio', { p_id: 'n1' }).order('n', { ascending: false }).range(1, 2);
    expect(db.anelli).toEqual([
      ['order', 'n', { ascending: false }],
      ['range', 1, 2],
    ]);
    expect(esito).toEqual({ data: [{ n: 4, negozio: 'b' }, { n: 3, negozio: 'a' }], error: null });
  });

  it('anche un filtro arriva, e così una riga sola chiesta con single', async () => {
    const db = databaseCheTaglia();
    g.__CLIENT_SUPABASE__ = db.client;
    const esito = await rpc('prodotti_del_negozio').eq('negozio', 'a').order('n').single();
    expect(db.anelli).toEqual([['eq', 'negozio', 'a'], ['order', 'n', undefined], ['single']]);
    expect(esito).toEqual({ data: { nome: 'prodotti_del_negozio', prima: { n: 2, negozio: 'a' } }, error: null });
  });

  it('un database della prova che risponde con una promessa nuda non cambia: gli anelli passano oltre', async () => {
    g.__CLIENT_SUPABASE__ = {
      from: () => ({}),
      rpc: async (nome: string) => ({ data: [{ nome }], error: null }),
    };
    const esito = await rpc('recensioni_del_negozio').order('created_at', { ascending: false }).range(20, 39);
    expect(esito).toEqual({ data: [{ nome: 'recensioni_del_negozio' }], error: null });
    expect(await rpc('recensioni_del_negozio').single()).toEqual({ data: { nome: 'recensioni_del_negozio' }, error: null });
  });
});
