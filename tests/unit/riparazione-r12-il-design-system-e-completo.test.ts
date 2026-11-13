/**
 * R12-010 — Il design system di riferimento era incompleto: il manifesto
 * elencava Button, Badge e Card (components/core/) e la loro scheda, ma la
 * cartella core/ non c'era, e ProductCard.jsx importava '../core/Badge.jsx' da
 * un file assente.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const RADICE = join(process.cwd(), 'docs/mockup');
const manifesto = JSON.parse(readFileSync(join(RADICE, '_ds_manifest.json'), 'utf8')) as {
  components: Array<{ name: string; sourcePath: string }>;
  startingPoints: Array<{ path: string; previewPath?: string }>;
};

function fileJsx(cartella: string): string[] {
  return readdirSync(cartella).flatMap((n) => {
    const p = join(cartella, n);
    return statSync(p).isDirectory() ? fileJsx(p) : p.endsWith('.jsx') ? [p] : [];
  });
}

describe('R12-010 il design system di riferimento è completo', () => {
  it('ogni componente del manifesto ha il suo file', () => {
    const mancanti = manifesto.components.filter((c) => !existsSync(join(RADICE, c.sourcePath))).map((c) => c.sourcePath);
    expect(mancanti).toEqual([]);
  });

  it('ogni scheda del manifesto ha il suo file e la sua anteprima', () => {
    const mancanti = manifesto.startingPoints
      .flatMap((s) => [s.path, s.previewPath].filter((x): x is string => !!x))
      .filter((p) => !existsSync(join(RADICE, p)));
    expect(mancanti).toEqual([]);
  });

  it('ogni import relativo dei componenti porta a un file che esiste', () => {
    const rotti: string[] = [];
    for (const f of fileJsx(join(RADICE, 'components'))) {
      for (const m of readFileSync(f, 'utf8').matchAll(/from\s+'(\.[^']+)'/g)) {
        if (!existsSync(resolve(dirname(f), m[1]))) rotti.push(`${f.slice(RADICE.length + 1)} → ${m[1]}`);
      }
    }
    expect(rotti).toEqual([]);
  });
});
