import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Sul sorgente, come le prove gemelle: le classi Tailwind non diventano stile in jsdom.
const FILE = [
  'app/admin/orders/page.tsx',
  'app/orders/[id]/page.tsx',
  'app/orders/page.tsx',
  'app/seller/analytics/page.tsx',
  'app/seller/dashboard/page.tsx',
  'app/seller/orders/page.tsx',
  'app/seller/products/page.tsx',
];

describe('etichette maiuscole delle pagine ordini e venditore: una sola spaziatura', () => {
  it.each(FILE)('%s: le righe uppercase usano solo tracking-label', (file) => {
    const righe = readFileSync(file, 'utf8').split('\n').filter((r) => /\buppercase\b/.test(r) && /tracking-/.test(r));
    for (const r of righe) {
      const classi = [...r.matchAll(/tracking-(?:\[[^\]]+\]|[a-z]+)/g)].map((m) => m[0]);
      for (const c of classi) expect(c, `${file}: ${r.trim()}`).toBe('tracking-label');
    }
  });
});
