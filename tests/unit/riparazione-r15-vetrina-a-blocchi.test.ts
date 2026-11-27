import { describe, it, expect } from 'vitest';
import { fetchSellerPublicMap } from '@/lib/queries/seller-public-profiles';
import { DIMENSIONE_BLOCCO } from '@/lib/supabase/blocchi';

/**
 * R15-014 — la lettura dei negozi della griglia andava con un solo `.in('id', …)`: oltre ~216 negozi
 * diversi l'indirizzo diventava troppo lungo (414). Ora si legge a blocchi e il risultato è completo.
 */
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

describe('R15-014 · la vetrina legge i negozi a blocchi', () => {
  it('250 negozi: più domande, nessuna oltre il blocco, risultato completo', async () => {
    const righe = Array.from({ length: 250 }, (_, i) => ({ id: `n${i}`, store_name: `Negozio ${i}`, is_approved: true }));
    const { client, domande } = vetrina(righe);
    const mappa = await fetchSellerPublicMap(client, righe.map((r) => r.id));
    expect(domande.length).toBeGreaterThan(1);
    for (const d of domande) expect(d.length).toBeLessThanOrEqual(DIMENSIONE_BLOCCO);
    expect(mappa.size).toBe(250);
    expect(mappa.get('n249')?.store_name).toBe('Negozio 249');
  });

  it('un blocco che cade fa cadere la lettura (niente vetrina a metà senza dirlo)', async () => {
    const client = {
      from: () => ({ select: () => ({ in: () => Promise.resolve({ data: null, error: { message: 'giu' } }) }) }),
    };
    await expect(fetchSellerPublicMap(client, ['a', 'b'])).rejects.toBeTruthy();
  });
});
