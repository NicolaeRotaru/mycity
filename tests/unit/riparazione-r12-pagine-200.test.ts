import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * R12 — pagine pubbliche col testo al 200% a 280 px (lo schermo esterno dei pieghevoli).
 * Prove leggere sul sorgente: ogni voce guarda le classi che chiudono il difetto misurato in Chrome.
 */

const leggi = (p: string) => readFileSync(p, 'utf8');

/** Il tag di apertura (con le sue classi) che precede un testo. */
const tagPrima = (src: string, testo: string, nome: string) => {
  const i = src.indexOf('\n' + ' '.repeat(14) + testo + '\n');
  expect(i, `«${testo}» non c'è`).toBeGreaterThan(-1);
  const aperture = [...src.slice(0, i).matchAll(new RegExp(`<${nome}\\b[^>]*>`, 'g'))];
  return aperture[aperture.length - 1]?.[0] ?? '';
};

describe('R12-001 · /about, «Come siamo arrivati qui» a 280 px col testo al 200%', () => {
  const src = leggi('app/about/page.tsx');
  it('il titolo va a capo dentro una parola lunga', () => {
    const h2 = tagPrima(src, 'Come siamo arrivati qui', 'h2');
    expect(h2).toContain('break-words');
    expect(h2).toContain('hyphens-auto');
  });
  it('la colonna del titolo può stringersi sotto la parola più larga (min-w-0)', () => {
    const div = tagPrima(src, 'Come siamo arrivati qui', 'div');
    expect(div).toContain('order-1');
    expect(div).toContain('min-w-0');
  });
});
