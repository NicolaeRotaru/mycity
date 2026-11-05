/**
 * S09 — Quali categorie sono «piene» (components/CategoryShowcase.tsx): schede 2624, 2623, 2629.
 */
import { describe, it, expect } from 'vitest';
import { categorieConProdotti, domandaCategoriePiene } from '@/components/CategoryShowcase';

type Riga = Record<string, unknown>;

/** Un database finto che rispetta `max_rows = 1000` come quello vero. */
function databaseFinto(tabelle: Record<string, Riga[]>) {
  return {
    from: (tabella: string) => {
      let righe = [...(tabelle[tabella] ?? [])];
      let tetto = 1000;
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (c: string, v: unknown) => { righe = righe.filter((r) => r[c] === v); return q; },
        order: (c: string) => { righe.sort((a, b) => String(a[c]).localeCompare(String(b[c]))); return q; },
        gt: (c: string, v: string) => { righe = righe.filter((r) => String(r[c]) > v); return q; },
        limit: (n: number) => { tetto = Math.min(n, 1000); return q; },
        then: (ok: (v: unknown) => unknown) => ok({ data: righe.slice(0, tetto), error: null }),
      };
      return q;
    },
  };
}

const CATEGORIE = [
  { id: 'c-ali', parent_id: null },
  { id: 'c-forno', parent_id: 'c-ali' },
  { id: 'c-casa', parent_id: null },
  { id: 'c-libri', parent_id: null },
];

describe('2624 — un prodotto in una sottocategoria rende piena anche la madre', () => {
  it('la tessera Alimentari c\'è anche se il prodotto sta in Forno', () => {
    const piene = categorieConProdotti(CATEGORIE, [{ category_id: 'c-forno' }]);
    expect(piene).toContain('c-forno');
    expect(piene).toContain('c-ali');
    expect(piene).not.toContain('c-casa');
  });
});

describe('domandaCategoriePiene', () => {
  it('2623 — i prodotti di un negozio non approvato non contano', async () => {
    const supa = databaseFinto({
      categories: CATEGORIE,
      seller_public_profiles: [{ id: 'n-pane' }],
      products: [
        { id: 'p1', category_id: 'c-forno', seller_id: 'n-pane', status: 'available' },
        { id: 'p2', category_id: 'c-casa', seller_id: 'n-in-attesa', status: 'available' },
      ],
    });
    const piene = await domandaCategoriePiene(supa).queryFn();
    expect(piene).toContain('c-ali');
    expect(piene).not.toContain('c-casa');
  });

  it('2629 — oltre mille prodotti la categoria in fondo non sparisce', async () => {
    const prodotti: Riga[] = Array.from({ length: 1500 }, (_, i) => ({
      id: `p${String(i).padStart(5, '0')}`, category_id: 'c-forno', seller_id: 'n-pane', status: 'available',
    }));
    prodotti.push({ id: 'p99999', category_id: 'c-libri', seller_id: 'n-pane', status: 'available' });
    const supa = databaseFinto({ categories: CATEGORIE, seller_public_profiles: [{ id: 'n-pane' }], products: prodotti });
    const piene = await domandaCategoriePiene(supa).queryFn();
    expect(piene).toContain('c-libri');
  });
});
