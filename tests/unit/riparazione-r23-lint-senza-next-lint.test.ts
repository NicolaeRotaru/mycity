import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

/**
 * R23-006 (13/11/2026) — IL LINT GIRAVA CON UN COMANDO CHE NEXT 16 TOGLIE.
 *
 * `"lint": "next lint"`: Next 15.5 lo stampa già come deprecato e Next 16 non ce l'ha più. Il
 * giorno dell'aggiornamento `npm run verify` (typecheck + lint + prove) si sarebbe fermato al
 * lint. Adesso il lint chiama ESLint direttamente, sulle stesse cartelle e con le stesse
 * estensioni che `next lint` guardava (le sue cartelle di sempre — app, pages, components,
 * lib, src — quelle che esistono), e con la cache nello stesso posto.
 *
 * Che resti verde lo dice il comando vero: `npm run lint` esce 0 (867 file, 0 errori).
 */

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
const lint = pkg.scripts.lint ?? '';
const parole = lint.split(/\s+/);

describe('il comando del lint', () => {
  it('non usa next lint', () => {
    expect(/\bnext\s+lint\b/.test(lint), 'il lint passa ancora da next lint, che Next 16 toglie').toBe(false);
  });

  it('chiama ESLint direttamente', () => {
    expect(parole[0]).toBe('eslint');
  });

  it('guarda tutte le cartelle che guardava next lint', () => {
    const cartelleDiNext = ['app', 'pages', 'components', 'lib', 'src'].filter((d) => existsSync(d));
    expect(cartelleDiNext.length).toBeGreaterThan(0);
    const mancanti = cartelleDiNext.filter((d) => !parole.includes(d));
    expect(mancanti, 'cartelle che next lint controllava e il nuovo comando no').toEqual([]);
  });

  it('guarda le stesse estensioni di next lint, TypeScript compreso', () => {
    const i = parole.indexOf('--ext');
    const estensioni = i >= 0 ? (parole[i + 1] ?? '').split(',') : [];
    for (const e of ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx']) {
      expect(estensioni, `manca ${e}`).toContain(e);
    }
  });

  it('npm run verify passa ancora dal lint', () => {
    expect(pkg.scripts.verify).toContain('npm run lint');
  });
});
