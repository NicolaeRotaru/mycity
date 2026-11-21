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
        // Il logo del negozio passa dal caricatore dei loghi: solo larghezza, mai il ritaglio
        // quadrato di caricatoreFotoRemote, che taglierebbe un marchio largo.
        if (img.includes('store_logo') || img.includes('logoNegozio')) {
          expect(img).toContain('loader={caricatoreLogoNegozio}');
          expect(img).not.toContain('caricatoreFotoRemote');
          expect(img).toMatch(/sizes=/);
        } else if (img.includes('sizedImage')) {
          expect(img).toContain('loader={caricatoreFotoRemote}');
          expect(img).toMatch(/sizes=/);
        }
      }
    });
  }
});
