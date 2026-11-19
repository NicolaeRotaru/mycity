import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};
const dichiarate = { ...pkg.dependencies, ...pkg.devDependencies };

// R05-015 — l'elenco delle librerie dice quello che il codice usa davvero.
describe('R05-015 le librerie dichiarate sono quelle usate', () => {
  it('dichiara iconv-lite: la usa pdfkit per le fatture, e senza dichiararla la versione non è più fissata da noi', () => {
    expect(dichiarate['iconv-lite']).toBeDefined();
  });

  it('dichiara il plugin @typescript-eslint che .eslintrc.json carica per nome', () => {
    const eslintrc = readFileSync(join(ROOT, '.eslintrc.json'), 'utf8');
    expect(eslintrc).toContain('"@typescript-eslint"');
    expect(pkg.devDependencies['@typescript-eslint/eslint-plugin']).toBeDefined();
  });

  it('il lint gira con eslint diretto, non con `next lint` che next 16 toglie', () => {
    expect(pkg.scripts.lint).toMatch(/^eslint /);
    expect(pkg.scripts.lint).not.toMatch(/next lint/);
  });

  it('il file delle versioni (package-lock.json) ripete lo stesso elenco del package.json', () => {
    const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8')) as {
      packages: Record<string, { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>;
    };
    const radice = lock.packages[''];
    expect(radice.dependencies?.['iconv-lite']).toBe(pkg.dependencies['iconv-lite']);
    expect(radice.devDependencies?.['@typescript-eslint/eslint-plugin']).toBe(
      pkg.devDependencies['@typescript-eslint/eslint-plugin'],
    );
  });
});
