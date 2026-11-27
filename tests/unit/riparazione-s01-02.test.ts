import { describe, it, expect } from 'vitest';
import { safeInternalPath } from '@/lib/safe-redirect';

/**
 * S01-02 — safeInternalPath: percorso risolto e barra rovesciata.
 *
 * Il valore restituito deve restare un percorso dello stesso sito anche dopo
 * la risoluzione dei segmenti «.» e «..» (pure codificati) fatta da chi lo usa.
 */

const CASA = 'https://interno.invalid';

describe('S01-02 safeInternalPath', () => {
  const rifiutati = [
    '/..//evil.com',
    '/.//evil.com',
    '/%2e%2e//evil.com',
    '/%2E%2E//evil.com',
    '/.%2e//evil.com',
    '/./\\evil.com',
    '/foo/..//evil.com',
    '/a/b/../..//evil.com/x?y=1',
    '/ok/path\\x',
  ];

  for (const input of rifiutati) {
    it(`ripiega per ${JSON.stringify(input)}`, () => {
      expect(safeInternalPath(input, '/fallback')).toBe('/fallback');
    });
  }

  it('nessun valore restituito, risolto, comincia con //', () => {
    for (const input of rifiutati) {
      const out = safeInternalPath(input, '/fallback');
      const risolto = new URL(out, CASA);
      expect(risolto.origin).toBe(CASA);
      expect(risolto.pathname.startsWith('//')).toBe(false);
    }
  });

  const ammessi = [
    '/',
    '/orders/123?tab=dettagli#riga',
    '/shop//doppio',
    '/a/../b',
    '/search?q=%2F%2Fnon-e-un-percorso',
    '/seller/products/new?from=abc',
    '/admin/orders?q=a\\b',
    '/checkout?passo=2#nota\\x',
  ];

  for (const input of ammessi) {
    it(`tiene ${JSON.stringify(input)}`, () => {
      expect(safeInternalPath(input, '/fallback')).toBe(input);
    });
  }
});
