import { describe, it, expect } from 'vitest';
import { CATEGORY_ATTRIBUTES } from '@/lib/category-attributes';

/**
 * R18-016 (parte senza scelte) — Il campo «Peso / Quantità» degli alimenti dice al negoziante a cosa
 * serve: il prezzo al chilo o al litro sulla scheda. Che sia obbligatorio resta una scelta di Nicola.
 */
describe('R18-016 · il campo peso degli alimenti spiega perché compilarlo', () => {
  const peso = CATEGORY_ATTRIBUTES.alimentari.find((f) => f.key === 'peso')!;
  it('porta un testo di aiuto che nomina quantità, unità e prezzo al chilo/litro', () => {
    expect(peso.helpText ?? '').toMatch(/quantità e unità/i);
    expect(peso.helpText ?? '').toMatch(/prezzo al chilo o al litro/i);
  });
  it('resta facoltativo e variabile per formato (nessuna decisione presa qui)', () => {
    expect(peso.required).toBeFalsy();
    expect(peso.variantable).toBe(true);
  });
});
