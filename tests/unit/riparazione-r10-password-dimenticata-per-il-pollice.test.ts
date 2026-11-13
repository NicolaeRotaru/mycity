import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * R10-003 — Nella pagina di accesso il bottone «Password dimenticata?» era alto
 * 16 px (solo text-xs, senza padding né altezza minima): sotto anche i 24 px
 * del criterio minimo WCAG 2.5.8, e troppo piccolo per il pollice.
 * Prova leggera di stile: il bottone deve avere un'area di tocco di 44 px.
 */
describe('R10-003 — «Password dimenticata?» si prende col pollice', () => {
  it('il bottone ha l’altezza minima di 44 px', () => {
    const src = readFileSync('app/sign-in/page.tsx', 'utf8');
    const fine = src.indexOf("'Password dimenticata?'");
    const bottone = src.slice(src.lastIndexOf('<button', fine), fine);
    const classi = bottone.match(/className="([^"]*)"/)?.[1] ?? '';
    expect(classi, 'il bottone è alto quanto il suo testo (16 px)').toMatch(/(^|\s)min-h-\[44px\](\s|$)/);
    expect(classi).toMatch(/(^|\s)inline-flex(\s|$)/);
  });
});
