import { describe, it, expect } from 'vitest';
import { resolveAiPatch, type CategoryRow } from '@/lib/products/aiPatch';

/**
 * Test di resolveAiPatch: traduzione del patch AI in UPDATE `products`.
 * Regole speculari ad applyPatch del ProductForm (categoria a due livelli,
 * attributi validati, tag come lista completa, annullamenti, guardia varianti).
 */

const categories: CategoryRow[] = [
  { id: 'top-food', name: 'Alimentari', slug: 'alimentari', parent_id: null },
  { id: 'sub-pane', name: 'Pane', slug: 'pane', parent_id: 'top-food' },
  { id: 'top-home', name: 'Casa', slug: 'casa', parent_id: null },
];

const base = {
  attributes: { marca: 'Vecchia' } as Record<string, unknown>,
  category_id: 'top-food',
  has_variants: false,
};

describe('resolveAiPatch', () => {
  it('applica prezzo, stato e tag (lista completa)', () => {
    const { update, changed } = resolveAiPatch({
      patch: { price: 4.9, status: 'sold', tags: ['Pane', 'pane', 'segale'] },
      current: base,
      categories,
    });
    expect(update.price).toBe(4.9);
    expect(update.status).toBe('sold');
    expect(update.tags).toEqual(['pane', 'segale']); // dedup + lowercase
    expect(changed).toContain('prezzo');
  });

  it('annulla compare_at_price e condition con null', () => {
    const { update } = resolveAiPatch({
      patch: { compare_at_price: null, condition: null },
      current: base,
      categories,
    });
    expect(update.compare_at_price).toBeNull();
    expect(update.condition).toBeNull();
  });

  it('risolve slug+sottocategoria in category_id', () => {
    const { update } = resolveAiPatch({
      patch: { category_slug: 'alimentari', subcategory_name: 'Pane' },
      current: base,
      categories,
    });
    expect(update.category_id).toBe('sub-pane');
  });

  it('ignora lo stock sui prodotti con varianti', () => {
    const { update } = resolveAiPatch({
      patch: { stock: 5 },
      current: { ...base, has_variants: true },
      categories,
    });
    expect('stock' in update).toBe(false);
  });

  it('unlimited_stock azzera lo stock (null)', () => {
    const { update } = resolveAiPatch({
      patch: { unlimited_stock: true },
      current: base,
      categories,
    });
    expect(update.stock).toBeNull();
  });

  it('merge attributi validi e rimozione, scartando i non validi per la categoria', () => {
    const { update } = resolveAiPatch({
      patch: { attributes: { origine: 'Italia', sconosciuto: 'x' }, attributes_remove: ['marca'] },
      current: base,
      categories,
    });
    expect(update.attributes).toEqual({ origine: 'Italia' });
  });

  it('scarta le opzioni non ammesse per i campi select', () => {
    const { update } = resolveAiPatch({
      patch: { attributes: { confezione: 'Astronave' } },
      current: base,
      categories,
    });
    // confezione è un select: valore fuori opzioni → ignorato (resta lo stato attuale)
    expect(update.attributes).toEqual({ marca: 'Vecchia' });
  });

  it('non scrive nulla per un patch vuoto', () => {
    const { update, changed } = resolveAiPatch({ patch: {}, current: base, categories });
    expect(Object.keys(update)).toHaveLength(0);
    expect(changed).toHaveLength(0);
  });
});
