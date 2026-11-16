import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('R19-006 · il proprietario vede la propria insegna anche se il negozio non è approvato', () => {
  // 16/11/2026 (R29-007) — anche il carrello.
  for (const file of ['app/checkout/page.tsx', 'app/shared-cart/page.tsx', 'app/cart/page.tsx']) {
    it(`${file}: per i negozi che la vista non restituisce legge nome da profiles (solo la propria riga)`, () => {
      const src = readFileSync(file, 'utf8');
      const i = src.indexOf('const senzaVista');
      expect(i).toBeGreaterThan(0);
      const blocco = src.slice(i, i + 700);
      expect(blocco).toMatch(/\.from\('profiles'\)\.select\('id, store_name'\)\.in\('id', senzaVista\)/);
      expect(blocco).toMatch(/\.has\(id\)|negozi\.has/);
    });
  }

  it('app/cart/page.tsx: il gruppo del negozio usa l insegna letta da profiles prima di «Negozio»', () => {
    const src = readFileSync('app/cart/page.tsx', 'utf8');
    expect(src).toMatch(/storeName: it\.storeName \?\? \(it\.sellerId \? insegnaPropria\[it\.sellerId\] : undefined\) \?\? 'Negozio'/);
    expect(src).toMatch(/setInsegnaPropria\(nomi\)/);
  });
});
