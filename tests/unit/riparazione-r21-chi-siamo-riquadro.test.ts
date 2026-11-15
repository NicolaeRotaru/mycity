import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * R21-005 — In «Chi siamo», coi caratteri grandi del telefono, la scritta
 * «Alla consegna» non esce dal suo riquadro: il valore va a capo, è più piccolo
 * sul telefono, e le celle della griglia si possono stringere.
 * Prova leggera: sono classi di stile.
 */
describe('R21-005 · il riquadro «Alla consegna» sta nella sua colonna', () => {
  const sorgente = readFileSync('app/about/page.tsx', 'utf8');
  const valore = sorgente.match(/<div className="([^"]*font-serif[^"]*text-primary-700[^"]*)">\s*\{s\.value\}/)?.[1] ?? '';
  const cella = sorgente.match(/key=\{s\.label\}\s*className="([^"]*)"/)?.[1] ?? '';

  it('il valore va a capo e sul telefono è più piccolo', () => {
    expect(valore).toMatch(/break-words/);
    expect(valore).toMatch(/\btext-xl\b/);
    expect(valore).not.toMatch(/(^|\s)text-2xl(\s|$)/);
  });
  it('la cella della griglia si può stringere', () => {
    expect(cella).toMatch(/\bmin-w-0\b/);
  });
});
