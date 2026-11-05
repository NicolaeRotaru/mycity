/**
 * S09 — La griglia «Caratteristiche» della scheda prodotto (lib/category-attributes.ts): 2162, 2164.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { attributoSpuntato, formatAttributeValue } from '@/lib/category-attributes';

describe('2162 — una casella si scrive come la leggono casella e marchio', () => {
  it('«1» e «0» su una casella diventano Sì e No', () => {
    expect(formatAttributeValue('1', 'bio')).toBe('Sì');
    expect(formatAttributeValue('0', 'bio')).toBe('No');
  });
  it('«sí» con l\'accento acuto è un sì per tutti', () => {
    expect(attributoSpuntato('sí')).toBe(true);
    expect(formatAttributeValue('sí', 'bio')).toBe('Sì');
  });
  it('la scheda passa la chiave alla griglia', () => {
    expect(readFileSync('app/product/[id]/page.tsx', 'utf8')).toContain('formatAttributeValue(value, key)');
  });
});

describe('2164 — un campo di testo resta testo', () => {
  it('«no» negli allergeni non diventa «No», «yes» nella marca non diventa «Sì»', () => {
    expect(formatAttributeValue('no', 'allergeni')).toBe('no');
    expect(formatAttributeValue('yes', 'marca')).toBe('yes');
  });
  it('la data di un campo conosciuto resta in formato italiano', () => {
    expect(formatAttributeValue('2026-11-05', 'scadenza')).toBe('05/11/2026');
  });
});

describe('2158 — la descrizione della foto scritta dal negozio arriva a chi non vede', () => {
  it('la prima foto e la lente usano alt_text quando c\'è', () => {
    const src = readFileSync('app/product/[id]/page.tsx', 'utf8');
    expect(src).toMatch(/const altDelNegozio = \(product\.attributes as Record<string, unknown> \| null \| undefined\)\?\.alt_text;/);
    expect(src).toContain('alt={i === 0 ? altPrimaFoto :');
    expect(src).toContain('alt={activeImg === 0 ? altPrimaFoto :');
  });
});
