import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * R16-001 — Nei file della sessione le ombre sono quelle calde del brand (`shadow-warm-*`,
 * tailwind.config.ts) o le neutre dichiarate (`shadow-sm-neutral`, `shadow-card`): non le
 * `shadow`/`shadow-sm/md/lg/xl/2xl` nere di Tailwind.
 */
const FILE = [
  'app/admin/orders/page.tsx', 'app/admin/page.tsx', 'app/cart/page.tsx', 'app/orders/[id]/page.tsx',
  'app/orders/page.tsx', 'app/page.tsx', 'app/profile/page.tsx', 'app/rider/profile/page.tsx',
  'app/sell/page.tsx', 'app/seller/dashboard/page.tsx', 'app/seller/orders/page.tsx', 'app/seller/page.tsx',
  'components/ActivePromoBadge.tsx', 'components/CartCrossDeviceSync.tsx', 'components/ProductCard.tsx',
  'components/ProductQA.tsx',
];
const FREDDA = /(?<![\w-])shadow(-sm|-md|-lg|-xl|-2xl)?(?![\w-])/;

describe('R16-001 · ombre calde del brand', () => {
  it.each(FILE)('%s non usa le ombre nere di Tailwind', (f) => {
    const righe = readFileSync(join(process.cwd(), f), 'utf8').split('\n');
    const trovate = righe
      .map((r, i) => ({ r, n: i + 1 }))
      .filter(({ r }) => /className|class=/.test(r) && FREDDA.test(r.replace(/transition-shadow/g, '')));
    expect(trovate.map((t) => `${f}:${t.n}`)).toEqual([]);
  });
});
