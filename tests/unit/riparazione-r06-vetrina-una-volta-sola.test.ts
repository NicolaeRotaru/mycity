/**
 * @vitest-environment jsdom
 */
/**
 * R06-009 (12/11/2026) — IN HOME OGNI SEZIONE CHIEDEVA DI NUOVO LO STESSO NEGOZIO.
 *
 * `fetchSellerPublicMap` faceva sempre una domanda nuova alla vetrina: sei-otto
 * sezioni della home, sei-otto domande per la stessa riga di Pane Quotidiano, e
 * ogni fascia compariva un giro di rete piu' tardi. Ora nel browser ogni negozio
 * letto resta in memoria qualche minuto, e una domanda in volo si aspetta.
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
  it('lo stesso negozio chiesto da due sezioni va al database una volta sola', async () => {
    const { client, domande } = vetrina([PANE, LATTE]);
    const prima = await fetchSellerPublicMap(client, ['pane']);
    const seconda = await fetchSellerPublicMap(client, ['pane']);
    expect(prima.get('pane')?.store_name).toBe('Pane Quotidiano');
    expect(seconda.get('pane')?.store_name).toBe('Pane Quotidiano');
    expect(domande.length, 'Ogni sezione della home richiedeva lo stesso negozio alla vetrina').toBe(1);
  });

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

  it('si chiede solo il negozio che manca', async () => {
    const { client, domande } = vetrina([PANE, LATTE]);
    await fetchSellerPublicMap(client, ['pane']);
    const m = await fetchSellerPublicMap(client, ['pane', 'latte']);
    expect(m.size).toBe(2);
    expect(domande).toEqual([['pane'], ['latte']]);
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
});
