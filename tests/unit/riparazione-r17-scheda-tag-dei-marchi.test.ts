import { describe, it, expect } from 'vitest';
import { leggiRigaDelProdotto } from '@/lib/queries/catalogo';
import { deriveQualityMarks } from '@/lib/products/qualityMarks';

/**
 * R17-005 — I marchi «Km 0» e «Artigianale» vengono solo dai tag, ma la scheda non
 * leggeva i tag. Il finto client risponde con i tag SOLO se la colonna e' stata chiesta,
 * come fa il database vero con le colonne elencate per nome.
 */
function clienteConColonne(riga: Record<string, unknown>) {
  let colonne = '';
  const q: Record<string, unknown> = {};
  q.select = (c: string) => { colonne = c; return q; };
  q.eq = () => q;
  q.maybeSingle = async () => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(riga)) if (k !== 'tags' || /\btags\b/.test(colonne)) out[k] = v;
    return { data: out, error: null };
  };
  return { from: () => q } as never;
}

describe('R17-005 — la scheda legge i tag dei marchi', () => {
  it('Km 0 e Artigianale compaiono sulla scheda', async () => {
    const supa = clienteConColonne({ id: 'p1', name: 'Pane', description: null, attributes: {}, tags: ['Km 0', 'Artigianale', 'estate'] });
    const riga = await leggiRigaDelProdotto(supa, 'p1');
    const chiavi = deriveQualityMarks(riga as never).map((m) => m.key);
    expect(chiavi).toContain('km0');
    expect(chiavi).toContain('artigianale');
  });
  it('Bio, Vegano, Senza glutine dai tag NON accendono il marchio (solo le caselle)', async () => {
    const supa = clienteConColonne({ id: 'p1', name: 'Pane', description: null, attributes: {}, tags: ['bio', 'vegano', 'senza glutine', 'senza lattosio', 'km0'] });
    const riga = await leggiRigaDelProdotto(supa, 'p1');
    const chiavi = deriveQualityMarks(riga as never).map((m) => m.key);
    expect(chiavi).toEqual(['km0']);
  });
  it('le caselle del negoziante continuano a valere', async () => {
    const supa = clienteConColonne({ id: 'p1', name: 'Pane', description: null, attributes: { bio: true }, tags: ['km0'] });
    const riga = await leggiRigaDelProdotto(supa, 'p1');
    const chiavi = deriveQualityMarks(riga as never).map((m) => m.key).sort();
    expect(chiavi).toEqual(['bio', 'km0']);
  });
});
