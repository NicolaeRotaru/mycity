/**
 * R10-014 / R10-002 — La scala dei testi (app/globals.css: 10, 12, 14, 16, 18, 20, 24, 30, 36, 48, 60 px)
 * non si aggira con `text-[Npx]` quando il gradino esiste. Nei file della sessione: nessuna misura a mano
 * che coincide con un gradino (11, 13, 15, 17, 22, 26, 32 px restano: non hanno gradino, serve una scelta).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FILE = [
  'app/admin/products/[id]/edit/page.tsx', 'app/globals.css', 'app/orders/[id]/page.tsx', 'app/orders/page.tsx',
  'app/rider/earnings/page.tsx', 'app/search/page.tsx', 'app/seller/dashboard/page.tsx', 'components/ProductCard.tsx',
  'components/admin/AdminSidebar.tsx', 'components/seller/SellerShell.tsx',
];
const GRADINI = new Set([10, 12, 14, 16, 18, 20, 24, 30, 36, 48, 60]);
const senzaCommenti = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('R10-014 / R10-002 — niente text-[Npx] dove la scala ha il gradino', () => {
  for (const f of FILE) {
    it(f, () => {
      const src = senzaCommenti(readFileSync(join(process.cwd(), f), 'utf8'));
      const aggirati = [...src.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)].map((m) => m[0]).filter((m) => GRADINI.has(Number(m.match(/[\d.]+/)![0])));
      expect(aggirati).toEqual([]);
    });
  }
  it('text-2xs esiste nella configurazione (gradino da 10px)', () => {
    expect(readFileSync(join(process.cwd(), 'tailwind.config.ts'), 'utf8')).toMatch(/'2xs':\s*'0\.625rem'/);
  });
});
