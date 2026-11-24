/**
 * R02-006 — LA PAGINA 404 COL TESTO AL 200% NON FA SCORRERE DI LATO.
 *
 * Misurato in Chromium a 280 px con la radice del testo a 32px: il numero «404» (text-7xl = 144 px)
 * era più largo del contenitore e portava la pagina a 285 px. Su schermo stretto il numero parte più
 * piccolo e cresce solo da `sm` in su.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const classi = (s: string) => s.split(/\s+/).filter(Boolean);

describe('R02-006 — il numero 404 non allarga la pagina a 280 px', () => {
  const src = readFileSync('app/not-found.tsx', 'utf8');
  const m = src.match(/<p className="([^"]*)">\s*404\s*<\/p>/);

  it('il numero 404 si trova ancora nella pagina', () => {
    expect(m, 'il paragrafo «404» non si trova più: la prova va rifatta').toBeTruthy();
  });

  it('sullo schermo stretto il numero è più piccolo di text-7xl e cresce solo da sm in su', () => {
    const c = classi(m![1]);
    expect(c, 'text-7xl senza prefisso: a 280 px col testo al 200% esce di 5 px').not.toContain('text-7xl');
    expect(c).toContain('text-6xl');
    expect(c).toContain('sm:text-7xl');
    expect(c).toContain('md:text-9xl');
  });
});
