import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Le etichette in maiuscolo respirano tutte con `tracking-label` (0.04em, tailwind.config.ts).
 * Nelle pagine qui sotto nessuna stringa di classi con `uppercase` può portare un altro
 * `tracking-*`.
 */
const FILE = ['app/help/page.tsx', 'app/profile/page.tsx', 'app/sell/page.tsx', 'app/shop-of-month/page.tsx'];

function stringheConUppercase(testo: string): string[] {
  const trovate: string[] = [];
  for (const m of testo.matchAll(/(["'`])((?:(?!\1)[^\\\n]|\\.)*)\1/g)) {
    if (/(^|\s)uppercase(\s|$)/.test(m[2])) trovate.push(m[2]);
  }
  return trovate;
}

describe('le etichette maiuscole usano tutte tracking-label', () => {
  for (const f of FILE) {
    it(f, () => {
      const stringhe = stringheConUppercase(readFileSync(join(process.cwd(), f), 'utf8'));
      const storte = stringhe.flatMap((s) => s.split(/\s+/).filter((c) => /^tracking-/.test(c) && c !== 'tracking-label'));
      expect(storte, 'etichette maiuscole con una spaziatura diversa da tracking-label').toEqual([]);
    });
  }
  it('la lettura trova davvero delle etichette maiuscole', () => {
    const tutte = FILE.flatMap((f) => stringheConUppercase(readFileSync(join(process.cwd(), f), 'utf8')));
    expect(tutte.length).toBeGreaterThan(0);
  });
});
