import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** R09-018 — i tasti «Indietro» del fattorino hanno almeno 44x44 px (h-11 w-11). Legge il sorgente. */
const PAGINE = ['app/rider/orders/[id]/page.tsx', 'app/rider/help/page.tsx', 'app/rider/onboarding/page.tsx'];

describe('R09-018 tasto Indietro del fattorino', () => {
  it.each(PAGINE)('%s', (file) => {
    const src = readFileSync(join(process.cwd(), file), 'utf8');
    const m = src.match(/<Link\b(?:(?!<\/Link>)[\s\S])*?<(?:ArrowLeft|ChevronLeft)\b/g);
    expect(m, 'tasto indietro non trovato').not.toBeNull();
    for (const blocco of m!) {
      expect(blocco).toContain('h-11 w-11');
      expect(blocco).not.toMatch(/\bh-9\b|\bw-9\b/);
    }
  });
});
