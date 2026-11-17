import { describe, expect, it } from 'vitest';
import { categorieConProdotti } from '@/lib/queries/categorie-piene';
import { getAttributesForCategory } from '@/lib/category-attributes';

/**
 * 17/11/2026 — Il conto delle categorie piene risale l'albero quanto il modulo prodotto.
 * Prima si fermava dieci gradini sopra la categoria del prodotto, mentre il modulo arriva a
 * venti: un prodotto in fondo a un albero profondo si pubblicava, ma la sua radice risultava
 * vuota e spariva dalla home.
 */

/** Una fila di categorie: c0 è la radice, c{n-1} la foglia. */
function fila(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `c${i}`,
    slug: i === 0 ? 'alimentari' : `livello-${i}`,
    parent_id: i === 0 ? null : `c${i - 1}`,
  }));
}

describe('categorie piene in un albero profondo', () => {
  it('fino a dove il modulo prodotto ritrova la radice, la radice risulta piena', () => {
    const categorie = fila(21); // la foglia ha venti gradini sopra di sé
    const foglia = categorie[categorie.length - 1].id;
    // Il modulo prodotto, da quella foglia, arriva alla radice.
    expect(getAttributesForCategory(categorie, foglia).topSlug).toBe('alimentari');
    const piene = categorieConProdotti(categorie, [{ category_id: foglia }]);
    expect(piene).toContain('c0');
    expect(piene).toHaveLength(21);
  });

  it('una fila di quindici livelli è piena tutta', () => {
    const categorie = fila(15);
    const piene = categorieConProdotti(categorie, [{ category_id: 'c14' }]);
    expect([...piene].sort()).toEqual(categorie.map((c) => c.id).sort());
  });

  it('un cerchio nei dati non fa girare il conto per sempre', () => {
    const categorie = [
      { id: 'a', parent_id: 'b' },
      { id: 'b', parent_id: 'a' },
    ];
    expect([...categorieConProdotti(categorie, [{ category_id: 'a' }])].sort()).toEqual(['a', 'b']);
  });
});
