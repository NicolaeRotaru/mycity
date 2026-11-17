import { afterEach, describe, expect, it } from 'vitest';
import { supabase } from './aiuti/finti/supabase-client.mjs';

/**
 * 17/11/2026 — Il client Supabase finto delle pagine montate deve concatenare la risposta di una
 * funzione del database come quello vero: `.rpc(...).order(...).range(...)` e poi l'attesa.
 * Prima `rpc` tornava una promessa nuda e il secondo anello si rompeva.
 */
type Esito = { data: unknown; error: unknown };
type Anello = PromiseLike<Esito> & {
  order: (...a: unknown[]) => Anello;
  range: (...a: unknown[]) => Anello;
  single: () => Promise<Esito>;
};
const rpc = supabase.rpc as unknown as (nome: string, argomenti?: Record<string, unknown>) => Anello;

/** Il risultato della catena, oppure «rotta» se un anello cade: la prova guarda l'esito, non il messaggio. */
async function esitoDellaCatena(fai: () => PromiseLike<Esito>): Promise<Esito | 'rotta'> {
  try {
    return await fai();
  } catch {
    return 'rotta';
  }
}

const g = globalThis as { __CLIENT_SUPABASE__?: unknown };
afterEach(() => {
  delete g.__CLIENT_SUPABASE__;
});

describe('il client finto: .rpc().order().range()', () => {
  it('senza database della prova la catena arriva in fondo con la risposta vuota di sempre', async () => {
    const esito = await esitoDellaCatena(() => rpc('recensioni_del_negozio', { p_id: 'n1' }).order('created_at').range(0, 19));
    expect(esito).toEqual({ data: null, error: null });
  });

  it('con il database della prova la catena porta la sua risposta', async () => {
    g.__CLIENT_SUPABASE__ = {
      from: () => ({}),
      rpc: async (nome: string) => ({ data: [{ nome }], error: null }),
    };
    const esito = await esitoDellaCatena(() => rpc('recensioni_del_negozio').order('created_at', { ascending: false }).range(20, 39));
    expect(esito).toEqual({ data: [{ nome: 'recensioni_del_negozio' }], error: null });
  });

  it('l’attesa diretta, senza anelli, resta com’era', async () => {
    expect(await rpc('qualcosa')).toEqual({ data: null, error: null });
  });
});
