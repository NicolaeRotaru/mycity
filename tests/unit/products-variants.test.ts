import { describe, it, expect } from 'vitest';
import {
  buildVariantLabel,
  buildCombinations,
  reconcileVariants,
  deriveOptionGroups,
  findVariant,
  totalVariantStock,
  optionsKey,
  normalizeVariants,
  type ProductVariant,
} from '@/lib/products/variants';

describe('variants helpers', () => {
  it('buildVariantLabel unisce i valori con il separatore', () => {
    expect(buildVariantLabel({ Taglia: 'M', Colore: 'Bianco' })).toBe('M · Bianco');
    expect(buildVariantLabel({})).toBe('');
  });

  it('buildCombinations fa il prodotto cartesiano e deduplica i valori', () => {
    const combos = buildCombinations([
      { name: 'Taglia', values: ['S', 'M', 's'] }, // 's' duplicato di 'S'
      { name: 'Colore', values: ['Bianco', 'Nero'] },
    ]);
    expect(combos).toHaveLength(4); // 2 taglie × 2 colori
    expect(combos).toContainEqual({ Taglia: 'S', Colore: 'Bianco' });
    expect(combos).toContainEqual({ Taglia: 'M', Colore: 'Nero' });
  });

  it('reconcileVariants conserva stock e id delle combinazioni invariate', () => {
    const existing: ProductVariant[] = [
      { id: 'v1', options: { Taglia: 'M' }, label: 'M', stock: 7 },
    ];
    const next = reconcileVariants([{ name: 'Taglia', values: ['M', 'L'] }], existing);
    const m = next.find((v) => v.options.Taglia === 'M');
    const l = next.find((v) => v.options.Taglia === 'L');
    expect(m).toMatchObject({ id: 'v1', stock: 7 });
    expect(l).toMatchObject({ stock: 0 });
    expect(l!.id).toBeUndefined();
  });

  it('deriveOptionGroups ricostruisce i gruppi dai valori delle varianti', () => {
    const variants: ProductVariant[] = [
      { options: { Taglia: 'S', Colore: 'Bianco' }, label: 'S · Bianco', stock: 1 },
      { options: { Taglia: 'M', Colore: 'Nero' }, label: 'M · Nero', stock: 2 },
    ];
    const groups = deriveOptionGroups(variants);
    expect(groups.map((g) => g.name)).toEqual(['Taglia', 'Colore']);
    expect(groups[0].values).toEqual(['S', 'M']);
    expect(groups[1].values).toEqual(['Bianco', 'Nero']);
  });

  it('findVariant richiede match esatto su tutte le opzioni', () => {
    const variants: ProductVariant[] = [
      { options: { Taglia: 'M', Colore: 'Bianco' }, label: 'M · Bianco', stock: 3 },
    ];
    expect(findVariant(variants, { Taglia: 'M', Colore: 'Bianco' })?.stock).toBe(3);
    expect(findVariant(variants, { Taglia: 'M' })).toBeNull(); // selezione parziale
    expect(findVariant(variants, { Taglia: 'M', Colore: 'Nero' })).toBeNull();
  });

  it('totalVariantStock somma e ignora valori non validi', () => {
    expect(
      totalVariantStock([
        { options: {}, label: 'a', stock: 4 },
        { options: {}, label: 'b', stock: 6 },
        { options: {}, label: 'c', stock: Number.NaN },
      ]),
    ).toBe(10);
  });

  it('optionsKey è stabile rispetto all’ordine delle chiavi', () => {
    expect(optionsKey({ Taglia: 'M', Colore: 'Bianco' })).toBe(optionsKey({ Colore: 'Bianco', Taglia: 'M' }));
  });

  it('normalizeVariants ripulisce dati grezzi del DB', () => {
    const out = normalizeVariants([
      { id: 'v1', options: { Taglia: 'M' }, label: 'M', stock: '5', position: 0 },
      { options: { Taglia: 'L' }, stock: -3 }, // label assente, stock negativo
      null,
      'spazzatura',
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: 'v1', stock: 5 });
    expect(out[1]).toMatchObject({ label: 'L', stock: 0 });
  });
});
