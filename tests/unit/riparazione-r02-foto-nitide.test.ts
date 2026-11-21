import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const PAGINE = ['app/shared-cart/page.tsx', 'app/seller/products/page.tsx', 'app/orders/[id]/page.tsx'];

describe('foto nitide: niente unoptimized, con loader e sizes', () => {
  for (const p of PAGINE) {
    it(`${p} non spegne srcset e sizes`, () => {
      const src = readFileSync(p, 'utf8');
      expect(src).not.toMatch(/\bunoptimized\b/);
      expect(src).toContain("import caricatoreFotoRemote from '@/lib/image-loader'");
      const immagini = src.match(/<Image[\s\S]*?\/>/g) ?? [];
      expect(immagini.length).toBeGreaterThan(0);
      for (const img of immagini) {
        if (img.includes('sizedImage') || img.includes('logoNegozio')) {
          expect(img).toContain('loader={caricatoreFotoRemote}');
          expect(img).toMatch(/sizes=/);
        }
      }
    });
  }
});
