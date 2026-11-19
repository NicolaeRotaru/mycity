import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const LAYOUT = readFileSync(join(ROOT, 'app', 'layout.tsx'), 'utf8');

// R05-019 — i caratteri non si scaricano piu da Google durante la costruzione.
describe('R05-019 i caratteri vengono dal disco, il sito resta uguale', () => {
  it('il layout non importa next/font/google', () => {
    expect(LAYOUT).not.toMatch(/next\/font\/google/);
    expect(LAYOUT).toMatch(/from 'next\/font\/local'/);
  });

  it('Inter: stessa variabile CSS, stesso display, 100-900, dritto e corsivo', () => {
    const blocco = LAYOUT.slice(LAYOUT.indexOf('const inter = localFont'), LAYOUT.indexOf('const fraunces = localFont'));
    expect(blocco).toContain("variable: '--font-inter'");
    expect(blocco).toContain("display: 'swap'");
    expect(blocco).toMatch(/weight: '100 900', style: 'normal'/);
    expect(blocco).toMatch(/weight: '100 900', style: 'italic'/);
  });

  it('Fraunces: stessa variabile CSS, stesso display, 400-800, dritto e corsivo', () => {
    const blocco = LAYOUT.slice(LAYOUT.indexOf('const fraunces = localFont'), LAYOUT.indexOf('// metadataBase'));
    expect(blocco).toContain("variable: '--font-serif'");
    expect(blocco).toContain("display: 'swap'");
    expect(blocco).toMatch(/weight: '400 800', style: 'normal'/);
    expect(blocco).toMatch(/weight: '400 800', style: 'italic'/);
  });

  it('i quattro file sono identici (md5) a quelli che Google serviva per il latin', () => {
    const attesi: Record<string, string> = {
      'inter-latin-wght-normal.woff2': '260c81a4759baf163c025001c4f27872',
      'inter-latin-wght-italic.woff2': '0a81fe197e0d9dc351858cb422811e0a',
      'fraunces-latin-wght-normal.woff2': 'eb2486760f752e516255a61404d00f65',
      'fraunces-latin-wght-italic.woff2': '701ae03b51830e7c7ecf2ba700aef05a',
    };
    for (const [nome, md5] of Object.entries(attesi)) {
      const dati = readFileSync(join(ROOT, 'app', 'fonts', nome));
      expect(createHash('md5').update(dati).digest('hex'), nome).toBe(md5);
    }
  });
});
