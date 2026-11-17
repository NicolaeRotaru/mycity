import { afterEach, describe, expect, it } from 'vitest';
import { supabase } from './aiuti/finti/supabase-client.mjs';

/**
 * 17/11/2026 — Il client Supabase finto condiviso delle prove rispondeva a ogni funzione del
 * database con «nessun errore» (`{ data: null, error: null }`), anche a quelle che la prova non
 * aveva previsto: una pagina che salva con una funzione del database sembrava riuscita anche se non
 * scriveva niente. Ora una funzione non prevista risponde con un errore che dice quale mancava.
 */
type Esito = { data: unknown; error: { code?: string; message?: string } | null };
type Anello = PromiseLike<Esito> & {
  order: (...a: unknown[]) => Anello;
  range: (...a: unknown[]) => Anello;
  single: () => PromiseLike<Esito>;
};
const rpc = supabase.rpc as unknown as (nome: string, argomenti?: Record<string, unknown>) => Anello;

const g = globalThis as { __CLIENT_SUPABASE__?: unknown; __RISPOSTA_SUPABASE__?: unknown };
afterEach(() => {
  delete g.__CLIENT_SUPABASE__;
  delete g.__RISPOSTA_SUPABASE__;
});

/** Come scrive una pagina che salva con una funzione: riuscito se non c'è errore. */
async function salvaComeUnaPagina(nome: string): Promise<'salvato' | string> {
  const { error } = await rpc(nome, { p_testo: 'ciao' });
  return error ? `errore: ${error.message}` : 'salvato';
}

describe('il client finto: una funzione del database non prevista dalla prova', () => {
  it('senza database della prova non risponde «nessun errore»: l’errore dice quale funzione mancava', async () => {
    const esito = await rpc('salva_impostazioni_negozio', { p_id: 'n1' });
    expect(esito.data).toBeNull();
    expect(esito.error).not.toBeNull();
    expect(esito.error?.code).toBe('RPC_NON_PREVISTA');
    expect(esito.error?.message).toContain('«salva_impostazioni_negozio»');
  });

  it('una pagina che salva con una funzione non prevista non crede di aver salvato', async () => {
    expect(await salvaComeUnaPagina('salva_impostazioni_negozio')).toMatch(/^errore: .*«salva_impostazioni_negozio»/);
  });

  it('anche con gli anelli, con la riga sola, e con le letture decise da __RISPOSTA_SUPABASE__', async () => {
    g.__RISPOSTA_SUPABASE__ = { data: [{ id: 'p1' }], error: null };
    const catena = await rpc('prodotti_del_negozio').order('n').range(0, 9);
    const riga = await rpc('prodotti_del_negozio').single();
    for (const esito of [catena, riga]) {
      expect(esito.data).toBeNull();
      expect(esito.error?.code).toBe('RPC_NON_PREVISTA');
    }
  });

  it('un database della prova senza rpc non la prevede: errore anche lì', async () => {
    g.__CLIENT_SUPABASE__ = { from: () => ({}) };
    expect((await rpc('salva_qualcosa')).error?.code).toBe('RPC_NON_PREVISTA');
  });

  it('la funzione prevista dal database della prova risponde come prima, anche con «nessun errore»', async () => {
    g.__CLIENT_SUPABASE__ = { from: () => ({}), rpc: async () => ({ data: null, error: null }) };
    expect(await rpc('salva_impostazioni_negozio')).toEqual({ data: null, error: null });
    expect(await salvaComeUnaPagina('salva_impostazioni_negozio')).toBe('salvato');
  });
});
