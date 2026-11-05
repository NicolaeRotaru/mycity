import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * S01 — 91: la pagina Resi non mette al recesso condizioni che il codice e la
 * legge non permettono, e non promette un ritiro col corriere che il sito non fa.
 */
const pagina = readFileSync('app/returns/page.tsx', 'utf8').replace(/\s+/g, ' ');

describe('91 — la pagina Resi dice le regole vere', () => {
  it('il riquadro dice le esclusioni, non «qualsiasi prodotto»', () => {
    expect(pagina).not.toContain('qualsiasi prodotto');
    expect(pagina).toContain('esclusi i freschi e quelli fatti su ordinazione');
  });
  it('niente «etichette e confezione originale»: il recesso si riduce solo se rovinato o usato oltre la prova', () => {
    expect(pagina).not.toContain('Completo di etichette');
    expect(pagina).toContain('usato oltre la prova');
  });
  it('niente spedizione col pacco né reso «organizzato da noi»', () => {
    expect(pagina).not.toContain('Spedisci il pacco');
    expect(pagina).not.toContain('organizzato da noi');
  });
  it('niente garanzia per beni usati', () => {
    expect(pagina).not.toContain('beni usati');
  });
});
