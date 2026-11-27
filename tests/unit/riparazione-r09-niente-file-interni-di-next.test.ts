/**
 * La fila delle email dopo la risposta non si appoggia a file interni di Next (`next/dist/...`):
 * possono spostarsi a ogni versione. Vale per il file e, più in generale, per tutto il codice del sito.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function sorgenti(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return sorgenti(p);
    return /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

describe('nessun import da next/dist', () => {
  it('lib/api/dopo-la-risposta.ts importa solo API pubbliche', () => {
    const src = readFileSync('lib/api/dopo-la-risposta.ts', 'utf8');
    const importi = [...src.matchAll(/^\s*import[^;]*from\s+'([^']+)'/gm)].map((m) => m[1]);
    expect(importi.filter((i) => /^next\/dist/.test(i))).toEqual([]);
  });
  it('nessun file di app/, lib/ e components/ importa da next/dist', () => {
    const colpevoli = ['app', 'lib', 'components']
      .flatMap(sorgenti)
      .filter((f) => /(from|import\()\s*['"]next\/dist\//.test(readFileSync(f, 'utf8')));
    expect(colpevoli).toEqual([]);
  });
});
