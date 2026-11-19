import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8')) as {
  packages: Record<string, { version?: string; dev?: boolean }>;
};

function conta(v: string): number[] {
  return v.split('-')[0].split('.').map((n) => Number(n));
}
function almeno(v: string, minima: string): boolean {
  const a = conta(v);
  const b = conta(minima);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}

// R05-014 — `npm audit fix` (senza --force): versioni portate oltre quelle segnalate, solo strumenti da sviluppatore.
const CORRETTE: Array<[string, string]> = [
  ['node_modules/@typescript-eslint/eslint-plugin', '8.73.0'],
  ['node_modules/@typescript-eslint/parser', '8.73.0'],
  ['node_modules/@typescript-eslint/type-utils', '8.73.0'],
  ['node_modules/@typescript-eslint/typescript-estree', '8.73.0'],
  ['node_modules/@typescript-eslint/utils', '8.73.0'],
  ['node_modules/@typescript-eslint/typescript-estree/node_modules/minimatch', '11.0.9'],
  ['node_modules/create-ecdh', '4.0.5'],
  ['node_modules/create-ecdh/node_modules/bn.js', '4.12.5'],
];

describe('R05-014 le librerie degli sviluppatori hanno le versioni corrette', () => {
  it.each(CORRETTE)('%s e almeno %s', (percorso, minima) => {
    const voce = lock.packages[percorso];
    expect(voce, `${percorso} manca dal lock`).toBeDefined();
    expect(almeno(voce.version ?? '0.0.0', minima)).toBe(true);
  });

  it('tutte quelle aggiornate sono librerie degli sviluppatori (dev: true), nessuna va nel sito', () => {
    for (const [percorso] of CORRETTE) {
      expect(lock.packages[percorso].dev, percorso).toBe(true);
    }
  });
});
