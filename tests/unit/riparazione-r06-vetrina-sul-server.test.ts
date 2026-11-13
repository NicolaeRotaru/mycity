/**
 * @vitest-environment node
 */
/**
 * R06-009 (12/11/2026) — Sul server le domande alla vetrina NON si uniscono: una
 * mappa del modulo vive fra richieste di persone diverse e non deve passare dati
 * dall'una all'altra.
 */
import { describe, it, expect } from 'vitest';
import { fetchSellerPublicMap } from '@/lib/queries/seller-public-profiles';

describe('R06-009 · la vetrina sul server', () => {
  it('due domande insieme per lo stesso negozio vanno al database tutte e due', async () => {
    const domande: string[][] = [];
    const client = {
      from: () => ({
        select: () => ({
          in: (_c: string, ids: string[]) => {
            domande.push(ids);
            return Promise.resolve({ data: [{ id: 'pane', store_name: 'Pane', is_approved: true }], error: null });
          },
        }),
      }),
    };
    await Promise.all([fetchSellerPublicMap(client, ['pane']), fetchSellerPublicMap(client, ['pane'])]);
    expect(domande.length, 'Sul server le domande si univano: dati condivisi fra richieste diverse').toBe(2);
  });
});
