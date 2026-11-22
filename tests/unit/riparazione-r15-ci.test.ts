import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ci = readFileSync(join(process.cwd(), '.github/workflows/ci.yml'), 'utf8');

function lavoro(nome: string): string {
  const dopo = ci.split(new RegExp(`\\n  ${nome}:\\n`))[1] ?? '';
  return dopo.split(/\n  [a-z][\w-]*:\n/)[0];
}

describe('ci.yml: il lavoro delle prove unitarie', () => {
  it('installa Chromium per Playwright prima di lanciare le prove', () => {
    const l = lavoro('unit-tests');
    expect(l).toContain('npx playwright install --with-deps chromium');
    expect(l.indexOf('playwright install')).toBeLessThan(l.indexOf('run: npm run test'));
  });
});
