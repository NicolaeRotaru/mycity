import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * R12 — pagine pubbliche col testo al 200% a 280 px (lo schermo esterno dei pieghevoli).
 * Prove leggere sul sorgente: ogni voce guarda le classi che chiudono il difetto misurato in Chrome.
 */

const leggi = (p: string) => readFileSync(p, 'utf8');

/** Dall'ultima apertura di <nome> che precede un testo, fino al testo. */
const tagPrima = (src: string, testo: string, nome: string) => {
  const i = src.search(new RegExp('\\n\\s*' + testo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  expect(i, `«${testo}» non c'è`).toBeGreaterThan(-1);
  const da = src.slice(0, i).lastIndexOf(`<${nome}`);
  // Dall'apertura del tag fino al testo (le funzioni `=>` negli attributi non interrompono la lettura).
  return da < 0 ? '' : src.slice(da, i);
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

describe('R12-002 · /stores, i filtri a 280 px col testo al 200%', () => {
  const src = leggi('app/stores/page.tsx');
  it('«Aperti ora» può andare a capo e non supera la riga', () => {
    const bottone = tagPrima(src, 'Aperti ora', 'button');
    expect(bottone).toContain('max-w-full');
    expect(bottone).not.toContain('whitespace-nowrap');
  });
  it('il menu «Ordina i negozi» non supera mai la riga', () => {
    const sel = tagPrima(src, '<option value="rating">', 'select');
    expect(sel).toContain('max-w-full');
  });
});
