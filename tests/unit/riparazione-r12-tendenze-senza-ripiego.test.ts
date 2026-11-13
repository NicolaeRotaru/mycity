/**
 * R12-008 — Il ripiego della lettura delle tendenze caricava gli ultimi 8
 * prodotti (con view_count 0), che il riquadro «Trending ora» scarta sempre
 * (VISITE_MINIME_PER_LA_CLASSIFICA): una lettura di prodotti e negozi per niente.
 */
import { describe, it, expect } from 'vitest';
import { leggiTendenze } from '@/lib/queries/fasce-prodotti';

function lettore() {
  const tabelleLette: string[] = [];
  const catena = (): Record<string, unknown> => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'order', 'limit', 'neq', 'is']) q[m] = () => q;
    q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
    return q;
  };
  return {
    tabelleLette,
    rpc: async () => ({ data: [], error: null }),
    from: (t: string) => { tabelleLette.push(t); return catena(); },
  };
}

describe('R12-008 senza visite le tendenze non leggono prodotti che nessuno vedrà', () => {
  it('nessuna lettura di prodotti o negozi, e la fascia è vuota', async () => {
    const supa = lettore();
    const fascia = await leggiTendenze(supa as never);
    expect(fascia).toEqual([]);
    expect(supa.tabelleLette, 'il ripiego legge ancora gli ultimi prodotti').toEqual([]);
  });
});
