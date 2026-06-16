import { describe, it, expect } from 'vitest';
import { buildDraftProductInsert } from '@/lib/products/draftFromVision';
import type { CategoryRow } from '@/lib/products/aiPatch';

/**
 * Sorgente unica della bozza-da-foto (singola e massiva). Va blindata: categoria
 * risolta, attributi validati contro lo schema della categoria, condizione
 * estratta, default sicuri.
 */
const CATEGORIES: CategoryRow[] = [
  { id: 'casa-top', name: 'Casa', slug: 'casa', parent_id: null },
  { id: 'casa-lampade', name: 'Lampade', slug: 'lampade', parent_id: 'casa-top' },
  { id: 'abbig-top', name: 'Abbigliamento', slug: 'abbigliamento', parent_id: null },
];

describe('buildDraftProductInsert', () => {
  it('risolve categoria, valida attributi, estrae condizione, normalizza tag', () => {
    const out = buildDraftProductInsert({
      draft: {
        name: '  Lampada da tavolo  ',
        description: 'Bella lampada',
        category_slug: 'casa',
        suggested_price: 9.99,
        attributes: {
          marca: 'IKEA',
          stile: 'moderno', // select case-insensitive → 'Moderno'
          condizione: 'usato', // → campo condition, non attributo
          inesistente: 'x', // non è un campo di "casa" → scartato
        },
        tags: ['Lampada', 'lampada', 'CASA'],
        alt_text: 'lampada accesa',
      },
      imageUrls: ['https://x/1.jpg'],
      categories: CATEGORIES,
      sellerId: 'seller-1',
    });

    expect(out.category_id).toBe('casa-top');
    expect(out.name).toBe('Lampada da tavolo');
    expect(out.price).toBe(9.99);
    expect(out.condition).toBe('usato');
    expect(out.attributes.marca).toBe('IKEA');
    expect(out.attributes.stile).toBe('Moderno'); // valore canonico
    expect(out.attributes.alt_text).toBe('lampada accesa');
    expect(out.attributes.inesistente).toBeUndefined();
    expect(out.tags).toEqual(['lampada', 'casa']); // lowercase + dedup
    expect(out.status).toBe('draft');
    expect(out.stock).toBe(1);
    expect(out.unit).toBe('pezzo');
    expect(out.seller_id).toBe('seller-1');
  });

  it('preferisce subcategory_id alla categoria di primo livello', () => {
    const out = buildDraftProductInsert({
      draft: { name: 'X', category_id: 'casa-top', subcategory_id: 'casa-lampade' },
      imageUrls: ['https://x/1.jpg'],
      categories: CATEGORIES,
      sellerId: 's',
    });
    expect(out.category_id).toBe('casa-lampade');
  });

  it('default sicuri: nome, prezzo e categoria mancanti', () => {
    const out = buildDraftProductInsert({
      draft: { suggested_price: 0 },
      imageUrls: ['https://x/1.jpg'],
      categories: CATEGORIES,
      sellerId: 's',
    });
    expect(out.name).toBe('Nuovo prodotto');
    expect(out.price).toBe(1); // prezzo non valido → 1
    expect(out.category_id).toBeNull();
  });

  it('limita le immagini a 8', () => {
    const many = Array.from({ length: 12 }, (_, i) => `https://x/${i}.jpg`);
    const out = buildDraftProductInsert({
      draft: { name: 'X', category_slug: 'casa' },
      imageUrls: many,
      categories: CATEGORIES,
      sellerId: 's',
    });
    expect(out.images).toHaveLength(8);
  });
});
