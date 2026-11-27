import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * R06-004 (26/11/2026) — Un client passato da fuori ha la sua memoria a due secondi: non usa né riempie
 * quella condivisa, né quella di un altro client.
 */
const letturaAnonima = vi.fn(async () => ({ data: { id: 'pubblica' }, error: null }));
vi.mock('@/lib/supabase/anonimo', () => ({
  creaClientAnonimo: () => ({
    from: () => ({ select: () => ({ eq: () => ({ single: letturaAnonima }) }) }),
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { leggiPerMetadati, dimenticaLettureDeiMetadati } from '@/lib/supabase/lettura-per-metadati';

const clienteConSessione = (riga: unknown) => {
  const single = vi.fn(async () => ({ data: riga, error: null }));
  const client = { from: () => ({ select: () => ({ eq: () => ({ single }) }) }) } as unknown as SupabaseClient;
  return { client, single };
};

beforeEach(() => { dimenticaLettureDeiMetadati(); letturaAnonima.mockClear(); });

describe('R06-004 · memoria dei metadati e client da fuori', () => {
  it('la riga letta da un client da fuori non finisce nella memoria condivisa', async () => {
    const { client } = clienteConSessione({ id: 'privata-della-sessione' });
    await leggiPerMetadati('products', 'id', { id: '1' }, client);
    // Una lettura senza client sulla stessa domanda deve leggere davvero, non ritrovare la riga di prima.
    const r = await leggiPerMetadati<{ id: string }>('products', 'id', { id: '1' });
    expect(r).toEqual({ id: 'pubblica' });
    expect(letturaAnonima).toHaveBeenCalledTimes(1);
  });

  it('un client da fuori non legge la riga messa in memoria da un altro', async () => {
    await leggiPerMetadati('products', 'id', { id: '2' });
    const { client, single } = clienteConSessione({ id: 'sua' });
    const r = await leggiPerMetadati<{ id: string }>('products', 'id', { id: '2' }, client);
    expect(r).toEqual({ id: 'sua' });
    expect(single).toHaveBeenCalledTimes(1);
  });

  it('senza client la memoria a due secondi funziona ancora', async () => {
    await leggiPerMetadati('products', 'id', { id: '3' });
    await leggiPerMetadati('products', 'id', { id: '3' });
    expect(letturaAnonima).toHaveBeenCalledTimes(1);
  });

  it('due client da fuori diversi non si passano la riga', async () => {
    const primo = clienteConSessione({ id: 'del-primo' });
    const secondo = clienteConSessione({ id: 'del-secondo' });
    await leggiPerMetadati('products', 'id', { id: '4' }, primo.client);
    const r = await leggiPerMetadati<{ id: string }>('products', 'id', { id: '4' }, secondo.client);
    expect(r).toEqual({ id: 'del-secondo' });
    expect(secondo.single).toHaveBeenCalledTimes(1);
  });

  it('lo stesso client da fuori che chiede due volte legge una volta sola', async () => {
    const { client, single } = clienteConSessione({ id: 'sua' });
    await leggiPerMetadati('products', 'id', { id: '5' }, client);
    await leggiPerMetadati('products', 'id', { id: '5' }, client);
    expect(single).toHaveBeenCalledTimes(1);
  });
});
