import { describe, expect, it } from 'vitest';
import { buildCombinations, reconcileVariants } from '@/lib/products/variants';

const taglie = ['34', '36', '38', '40', '42', '44', '46', '48', '50', '52', '54'];
const colori = ['Bianco', 'Nero', 'Blu', 'Rosso', 'Verde', 'Giallo', 'Grigio', 'Rosa', 'Viola', 'Beige'];
const tipi = [
  { name: 'Taglia', values: taglie },
  { name: 'Colore', values: colori },
];

describe('R08-011 oltre cento combinazioni di taglia e colore', () => {
  it('le combinazioni sono tutte, anche le ultime', () => {
    const combos = buildCombinations(tipi);
    expect(combos).toHaveLength(taglie.length * colori.length);
    expect(combos[combos.length - 1]).toEqual({ Taglia: '54', Colore: 'Beige' });
  });
  it('anche l\'editor le tiene tutte, conservando lo stock', () => {
    const next = reconcileVariants(tipi, [
      { options: { Taglia: '54', Colore: 'Beige' }, label: '54 · Beige', stock: 7 },
    ]);
    expect(next).toHaveLength(110);
    expect(next[109].stock).toBe(7);
  });
});
