/**
 * R16-006 — a 280 px col testo al 200% il titolo «Negozi di Piacenza» (parola lunga in corpo grande)
 * allargava /stores oltre lo schermo. Misurato a pagina viva (viewport 280, html 200%): scrollWidth 381 -> 280
 * con break-words sul contenitore (overflow-wrap si eredita fino al titolo del CollectionHeader).
 * Prova leggera sul sorgente: ogni contenitore di pagina di /stores porta break-words.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('R16-006 · /stores a 280 px col testo grande', () => {
  it('i contenitori della pagina portano break-words', () => {
    const src = readFileSync(join(process.cwd(), 'app/stores/page.tsx'), 'utf8');
    const m = [...src.matchAll(/className="(container mx-auto max-w-7xl[^"]*)"/g)];
    expect(m.length).toBeGreaterThanOrEqual(3);
    for (const x of m) expect(x[1].split(/\s+/)).toContain('break-words');
  });
});
