import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { esclusiAncheDallaCategoria, segnaIDeperibili } from '@/lib/ordini/recesso-per-categoria';

/**
 * R09-015 (onda 2) — La regola «escluso dal recesso» aveva due copie: una nella rotta dei resi
 * (app/api/returns/create) e una per la scheda prodotto e il carrello (lib/ordini/recesso-per-categoria).
 * Erano già diverse: la rotta escludeva anche un prodotto conservato in frigorifero senza categoria dei
 * freschi, la scheda e il carrello no. Il cliente leggeva «reso entro 14 giorni» e poi la rotta rifiutava
 * «Cambio idea» (art. 49 c.1 lett. m e art. 59 Cod. Cons.: le esclusioni si dicono prima dell'acquisto).
 */

const MOZZARELLA = { id: 'p1', category_id: null, attributes: { conservazione: 'Frigorifero' }, non_recedibile: false };
const PASTA_SECCA = { id: 'p2', category_id: null, attributes: { conservazione: 'Luogo fresco e asciutto' }, non_recedibile: false };

/** Un client finto: le categorie si leggono, ma qui non servono. */
const supabase = {
  from: () => ({ select: async () => ({ data: [], error: null }) }),
} as never;

describe('R09-015 · scheda, carrello e resi dicono la stessa cosa sul recesso', () => {
  it('la scheda e il carrello segnano escluso un prodotto da frigorifero anche senza categoria dei freschi', async () => {
    const [m, p] = await esclusiAncheDallaCategoria(supabase, [MOZZARELLA, PASTA_SECCA]);
    expect(m.non_recedibile).toBe(true);
    expect(p.non_recedibile).toBe(false);
  });

  it('anche se la lettura delle categorie cade, il frigorifero vale', async () => {
    const rotto = { from: () => ({ select: async () => ({ data: null, error: { message: 'giù' } }) }) } as never;
    const [m] = await esclusiAncheDallaCategoria(rotto, [{ ...MOZZARELLA, category_id: 'c1' }]);
    expect(m.non_recedibile).toBe(true);
  });

  it('il pane in una sottocategoria resta escluso', () => {
    const [pane] = segnaIDeperibili([{ id: 'x', category_id: 'sotto' }], [
      { id: 'radice', slug: 'panificio', parent_id: null },
      { id: 'sotto', slug: 'pane-di-casa', parent_id: 'radice' },
    ]);
    expect((pane as { non_recedibile?: boolean }).non_recedibile).toBe(true);
  });

  it('la rotta dei resi usa la stessa regola, non una sua copia', () => {
    const rotta = readFileSync('app/api/returns/create/route.ts', 'utf8');
    expect(rotta).toMatch(/import \{[^}]*segnaIDeperibili[^}]*\} from '@\/lib\/ordini\/recesso-per-categoria'/);
    expect(rotta).not.toMatch(/function segnaIDeperibili|const CATEGORIE_DEPERIBILI|function daFrigorifero/);
  });
});
