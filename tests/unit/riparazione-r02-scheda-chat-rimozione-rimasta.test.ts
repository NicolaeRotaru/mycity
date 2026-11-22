import { describe, it, expect } from 'vitest';
import { righeDellaProposta } from '@/lib/products/prontoPerLaVendita';
import { resolveAiPatch, type AiProductPatch, type CategoryRow } from '@/lib/products/aiPatch';

/**
 * Un prodotto spostato di categoria si porta dietro un attributo (es. «gusto») che la scheda
 * attuale non ha. Il server lo toglie (`resolveAiPatch`), e la scheda della chat non lo mostrava.
 */
const CATEGORIE: CategoryRow[] = [{ id: 'casa', name: 'Casa', slug: 'casa', parent_id: null }];
const patch = { attributes_remove: ['gusto'] } as AiProductPatch;

describe('la scheda della chat mostra la rimozione di un attributo rimasto da una categoria di prima', () => {
  it('il server toglie «gusto» dal vaso di Casa', () => {
    const r = resolveAiPatch({
      patch,
      current: { attributes: { gusto: 'Fragola' }, category_id: 'casa', has_variants: false, price: 40 } as never,
      categories: CATEGORIE,
    });
    expect((r.update as { attributes?: Record<string, unknown> }).attributes).toEqual({});
  });

  it('e la scheda lo dice, quando il prodotto ha ancora quell attributo', () => {
    const righe = righeDellaProposta(patch, { price: 40, categorySlug: 'casa', attributes: { gusto: 'Fragola' } });
    expect(righe, 'prima la scheda taceva e il server toglieva lo stesso').toEqual(['Rimuovi gusto']);
  });

  it('se il prodotto non ha quell attributo non si promette niente', () => {
    expect(righeDellaProposta(patch, { price: 40, categorySlug: 'casa', attributes: { colore: 'Rosso' } })).toEqual([]);
    expect(righeDellaProposta(patch, { price: 40, categorySlug: 'casa' })).toEqual([]);
  });
});
