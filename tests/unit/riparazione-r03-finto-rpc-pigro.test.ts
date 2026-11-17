import { afterEach, describe, expect, it } from 'vitest';
import { supabase } from './aiuti/finti/supabase-client.mjs';

/**
 * 17/11/2026 — Il client Supabase vero manda la chiamata a una funzione del database solo quando
 * qualcuno aspetta la risposta: `void supabase.rpc('x')`, mai aspettata, non arriva mai. Il finto
 * delle prove la faceva partire subito, a `.rpc(...)`, e in una prova una chiamata che nel sito vero
 * si perde sembrava arrivata. Qui: si chiama il database della prova solo all'attesa, una volta sola
 * anche se si aspetta due volte.
 */
type Esito = { data: unknown; error: unknown };
type Anello = PromiseLike<Esito> & {
  order: (...a: unknown[]) => Anello;
  range: (...a: unknown[]) => Anello;
  single: () => PromiseLike<Esito>;
};
const rpc = supabase.rpc as unknown as (nome: string, argomenti?: Record<string, unknown>) => Anello;

const g = globalThis as { __CLIENT_SUPABASE__?: unknown };
afterEach(() => {
  delete g.__CLIENT_SUPABASE__;
});

function databaseCheConta() {
  const chiamate: Array<{ nome: string; argomenti: unknown }> = [];
  g.__CLIENT_SUPABASE__ = {
    from: () => ({}),
    rpc: async (nome: string, argomenti: unknown) => {
      chiamate.push({ nome, argomenti });
      return { data: [{ n: chiamate.length }], error: null };
    },
  };
  return chiamate;
}

describe('il client finto: la funzione del database parte solo all’attesa', () => {
  it('chiamata e mai aspettata, non arriva al database della prova', async () => {
    const chiamate = databaseCheConta();
    void rpc('conta_visita', { p_id: 'n1' });
    rpc('conta_visita', { p_id: 'n2' }).order('n').range(0, 9);
    await new Promise((r) => setTimeout(r, 0));
    expect(chiamate).toEqual([]);
  });

  it('parte all’attesa, con i suoi argomenti, e una volta sola anche se si aspetta due volte', async () => {
    const chiamate = databaseCheConta();
    const q = rpc('conta_visita', { p_id: 'n1' }).order('n');
    expect(chiamate).toEqual([]);
    const prima = await q;
    const seconda = await q;
    expect(chiamate).toEqual([{ nome: 'conta_visita', argomenti: { p_id: 'n1' } }]);
    expect(prima).toEqual({ data: [{ n: 1 }], error: null });
    expect(seconda).toEqual(prima);
  });

  it('anche la riga sola parte solo all’attesa', async () => {
    const chiamate = databaseCheConta();
    const q = rpc('conta_visita').single();
    expect(chiamate).toEqual([]);
    expect(await q).toEqual({ data: { n: 1 }, error: null });
    expect(chiamate).toHaveLength(1);
  });

  it('dentro Promise.all parte una volta sola, come nelle pagine', async () => {
    const chiamate = databaseCheConta();
    const [a] = await Promise.all([rpc('conta_visita')]);
    expect(a).toEqual({ data: [{ n: 1 }], error: null });
    expect(chiamate).toHaveLength(1);
  });
});
