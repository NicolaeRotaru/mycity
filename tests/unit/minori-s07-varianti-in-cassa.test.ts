import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { problemiDiDisponibilita } from '@/lib/ordini/merce-che-tengo-io';

describe('S07 · in cassa la variante finita non si porta via le altre', () => {
  it('il problema di disponibilità dice quale variante è finita', () => {
    const righe = [
      { id: 'torta', name: 'Torta della nonna', quantity: 1, variantId: 'piccola', variantLabel: 'piccola' },
      { id: 'torta', name: 'Torta della nonna', quantity: 1, variantId: 'grande', variantLabel: 'grande' },
    ];
    const scorta: Record<string, number> = { piccola: 2, grande: 0 };
    const problemi = problemiDiDisponibilita(righe, (r) => scorta[r.variantId!]);
    expect(problemi).toEqual([
      { id: 'torta', name: 'Torta della nonna', variantId: 'grande', variantLabel: 'grande', requested: 1, available: 0 },
    ]);
  });
  it('«Togli dal carrello» toglie solo quella riga e il testo nomina la variante', () => {
    const src = readFileSync('app/checkout/page.tsx', 'utf8');
    expect(src).toMatch(/stockIssues\.forEach\(\(s\) => removeFromCart\(s\.id, s\.variantId \?\? undefined\)\)/);
    expect(src).toMatch(/\$\{s\.variantLabel \? ` · \$\{s\.variantLabel\}` : ''\} \(richiesti/);
  });
  it('se la lettura delle taglie cade, la cassa non conta «disponibili 0»: la lettura si dichiara caduta', () => {
    const src = readFileSync('app/checkout/page.tsx', 'utf8');
    expect(src).toMatch(/const \{ data: vs, error: erroreVarianti \} = await supabase[\s\S]{0,600}if \(erroreVarianti\) throw erroreVarianti;/);
  });
});
