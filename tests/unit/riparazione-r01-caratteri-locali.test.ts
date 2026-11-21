import { describe, it, expect } from 'vitest';
import { existsSync, openSync, readSync, closeSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * La costruzione del sito non deve dipendere dal download dei caratteri da Google: il layout li
 * carica dai file di `app/fonts/` (next/font/local), che devono esistere ed essere woff2 veri.
 */
const LAYOUT = readFileSync('app/layout.tsx', 'utf8');

function primiQuattroByte(file: string): string {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(4);
    readSync(fd, buf, 0, 4, 0);
    return buf.toString('latin1');
  } finally {
    closeSync(fd);
  }
}

describe('i caratteri del sito stanno sul disco', () => {
  it('il layout non importa piu\' next/font/google', () => {
    expect(LAYOUT).not.toMatch(/from\s+['"]next\/font\/google['"]/);
    expect(LAYOUT).toMatch(/from\s+['"]next\/font\/local['"]/);
  });

  it('ogni src di localFont esiste ed e\' un woff2 vero (firma wOF2)', () => {
    const percorsi = [...LAYOUT.matchAll(/path\s*:\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(percorsi.length, 'nessun carattere locale nel layout').toBeGreaterThanOrEqual(12);
    for (const p of percorsi) {
      expect(p, `${p} non e' un woff2`).toMatch(/\.woff2$/);
      const file = path.join('app', p);
      expect(existsSync(file), `${file} non esiste`).toBe(true);
      expect(primiQuattroByte(file), `${file} non ha la firma wOF2`).toBe('wOF2');
    }
  });
});
