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

describe('package.json: le librerie usate dalle prove sono dichiarate', () => {
  it('@testing-library/dom, attr-accept ed esbuild stanno in devDependencies alla versione del lock', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
    const lock = JSON.parse(readFileSync(join(process.cwd(), 'package-lock.json'), 'utf8'));
    for (const nome of ['@testing-library/dom', 'attr-accept', 'esbuild']) {
      const versione = lock.packages[`node_modules/${nome}`].version;
      expect(pkg.devDependencies[nome], nome).toBe(versione);
      expect(lock.packages[''].devDependencies[nome], nome).toBe(versione);
    }
  });
});
