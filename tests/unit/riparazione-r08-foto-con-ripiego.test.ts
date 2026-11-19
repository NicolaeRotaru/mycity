import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const leggi = (p: string) => readFileSync(join(ROOT, p), 'utf8');

// Le foto di prodotto che il sito mostra devono passare da FotoConRipiego (ripiego se la foto è cancellata),
// non da <Image> nuda.
describe('R08-003 foto di prodotto con ripiego', () => {
  for (const file of ['app/product/[id]/page.tsx', 'components/RecentlyViewed.tsx', 'components/cart/CartUpsell.tsx']) {
    it(`${file} non usa <Image> nuda`, () => {
      const src = leggi(file);
      expect(src).not.toMatch(/<Image[\s>]/);
      expect(src).toMatch(/<FotoConRipiego[\s>]/);
    });
  }
});
