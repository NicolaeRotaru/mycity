/**
 * @vitest-environment jsdom
 */
/**
 * R06-009 (12/11/2026) — IN HOME OGNI SEZIONE CHIEDEVA DI NUOVO LO STESSO NEGOZIO.
 *
 * `fetchSellerPublicMap` faceva sempre una domanda nuova alla vetrina: sei-otto
 * sezioni della home, sei-otto domande per la stessa riga di Pane Quotidiano.
 * Ora nel browser una domanda gia' in volo per lo stesso negozio si aspetta, e
 * si chiedono solo i negozi che mancano. (La memoria di qualche minuto resta da
 * fare nei chiamanti, con React Query: e' nel referto.)
 */
import { describe, it, expect } from 'vitest';
import { fetchSellerPublicMap } from '@/lib/queries/seller-public-profiles';

function vetrina(righe: Array<{ id: string; store_name: string; is_approved: boolean }>) {
  const domande: string[][] = [];
  const client = {
    from: () => ({
      select: () => ({
        in: (_c: string, ids: string[]) => {
          domande.push([...ids]);
          return Promise.resolve({ data: righe.filter((r) => ids.includes(r.id)), error: null });
        },
      }),
    }),
  };
  return { client, domande };
}

const PANE = { id: 'pane', store_name: 'Pane Quotidiano', is_approved: true };
const LATTE = { id: 'latte', store_name: 'Latteria', is_approved: true };

describe('R06-009 · la vetrina nel browser', () => {
  it('due sezioni nello stesso istante: una domanda sola, l\'altra aspetta', async () => {
    const { client, domande } = vetrina([PANE, LATTE]);
    const [a, b] = await Promise.all([
      fetchSellerPublicMap(client, ['pane', 'latte']),
      fetchSellerPublicMap(client, ['pane']),
    ]);
    expect(a.size).toBe(2);
    expect(b.get('pane')?.store_name).toBe('Pane Quotidiano');
    expect(domande.length).toBe(1);
  });

  it('tre sezioni insieme: si chiede solo il negozio che manca', async () => {
    const { client, domande } = vetrina([PANE, LATTE]);
    const [a, b, c] = await Promise.all([
      fetchSellerPublicMap(client, ['pane']),
      fetchSellerPublicMap(client, ['pane', 'latte']),
      fetchSellerPublicMap(client, ['latte', 'pane']),
    ]);
    expect(a.size).toBe(1);
    expect(b.size).toBe(2);
    expect(c.size).toBe(2);
    expect(domande, 'Ogni sezione rifaceva la stessa domanda alla vetrina').toEqual([['pane'], ['latte']]);
  });

  it('a volo atterrato la domanda successiva torna al database (niente dati vecchi)', async () => {
    const { client, domande } = vetrina([PANE]);
    await fetchSellerPublicMap(client, ['pane']);
    await fetchSellerPublicMap(client, ['pane']);
    expect(domande.length).toBe(2);
  });

  it('una lettura caduta risale a chi chiama e non resta in memoria', async () => {
    let cade = true;
    const domande: string[][] = [];
    const client = {
      from: () => ({
        select: () => ({
          in: (_c: string, ids: string[]) => {
            domande.push(ids);
            return Promise.resolve(cade ? { data: null, error: { message: 'giu' } } : { data: [PANE], error: null });
          },
        }),
      }),
    };
    await expect(fetchSellerPublicMap(client, ['pane'])).rejects.toBeTruthy();
    cade = false;
    const m = await fetchSellerPublicMap(client, ['pane']);
    expect(m.get('pane')?.store_name).toBe('Pane Quotidiano');
  });

  it('colonne diverse non si mescolano: due select, due domande', async () => {
    const { client, domande } = vetrina([PANE]);
    await Promise.all([
      fetchSellerPublicMap(client, ['pane']),
      fetchSellerPublicMap(client, ['pane'], 'id, store_name, is_approved'),
    ]);
    expect(domande.length).toBe(2);
  });

  it('client diversi non si mescolano', async () => {
    const a = vetrina([PANE]);
    const b = vetrina([{ ...PANE, store_name: 'Altro forno' }]);
    const [ma, mb] = await Promise.all([
      fetchSellerPublicMap(a.client, ['pane']),
      fetchSellerPublicMap(b.client, ['pane']),
    ]);
    expect(ma.get('pane')?.store_name).toBe('Pane Quotidiano');
    expect(mb.get('pane')?.store_name).toBe('Altro forno');
  });
});
