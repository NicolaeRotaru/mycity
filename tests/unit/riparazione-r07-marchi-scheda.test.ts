import { describe, it, expect } from 'vitest';
import { leggiRigaDelProdotto } from '@/lib/queries/catalogo';
import { deriveQualityMarks } from '@/lib/products/qualityMarks';

/**
 * R07-025 (12/11/2026) — i marchi «Km 0» e «Artigianale» non comparivano mai sulla
 * scheda: `deriveQualityMarks` li ricava dai tag del prodotto, ma la scheda non
 * chiedeva la colonna `tags`. Qui il database finto restituisce solo le colonne
 * chieste, come PostgREST.
 */
const RIGA_IN_BANCA: Record<string, unknown> = {
  id: 'p1', name: 'Coppa piacentina', description: 'Stagionata in cantina', price: 12, images: [], seller_id: 's1',
  status: 'available', created_at: '2026-11-01T10:00:00Z', category_id: 'c1', stock: 4, attributes: {}, unit: 'pz',
  compare_at_price: null, condition: 'new', express_enabled: false, has_variants: false, external_source_url: null,
  tags: ['km 0', 'artigianale'], categories: { slug: 'salumi', name: 'Salumi' },
};

function soloLeColonneChieste(colonne: string) {
  const nomi = colonne.replace(/\([^)]*\)/g, '').split(',').map((c) => c.trim()).filter(Boolean);
  return Object.fromEntries(nomi.filter((n) => n in RIGA_IN_BANCA).map((n) => [n, RIGA_IN_BANCA[n]]));
}

const client = {
  from: () => ({
    select: (colonne: string) => ({
      eq: () => ({ maybeSingle: async () => ({ data: soloLeColonneChieste(colonne), error: null }) }),
    }),
  }),
};

describe('R07-025 · la scheda legge i tag, e i marchi compaiono', () => {
  it('un prodotto col tag «km 0» e «artigianale» mostra i due marchi', async () => {
    const riga = await leggiRigaDelProdotto(client as never, 'p1');
    expect(riga).not.toBeNull();
    const chiavi = deriveQualityMarks(riga as never).map((m) => m.key);
    expect(chiavi).toContain('km0');
    expect(chiavi.some((k) => /artigian/.test(k))).toBe(true);
  });
});
