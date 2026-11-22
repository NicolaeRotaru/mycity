import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Le etichette maiuscole usano una spaziatura sola, tracking-label (0.04em in tailwind.config.ts):
// qui i file di questa riparazione, riga per riga.
const ROOT = join(__dirname, '..', '..');
const VECCHIE = /\btracking-(?:wide|wider|widest|\[0\.0[3-8]em\])(?![\w-])/;

const righeMaiuscoleFuoriToken = (file: string) =>
  readFileSync(join(ROOT, file), 'utf8')
    .split('\n')
    .map((riga, i) => ({ riga: i + 1, testo: riga }))
    .filter(({ testo }) => /\buppercase\b/.test(testo) && VECCHIE.test(testo))
    .map(({ riga }) => `${file}:${riga}`);

describe('le etichette maiuscole hanno la spaziatura del token', () => {
  it.each(['app/profile/addresses/page.tsx', 'components/ProductQA.tsx'])('%s usa solo tracking-label', (file) => {
    expect(righeMaiuscoleFuoriToken(file)).toEqual([]);
  });

  it('il token tracking-label esiste ed è 0.04em', () => {
    expect(readFileSync(join(ROOT, 'tailwind.config.ts'), 'utf8')).toMatch(/label:\s*['"]0\.04em['"]/);
  });
});
