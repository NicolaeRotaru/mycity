import { describe, it, expect } from 'vitest';
import { normalizzaSocials, storeCustomizationSchema } from '@/lib/store-customization';

const sito = (v: string) => normalizzaSocials({ website: v })?.website;
const valido = (v: string) => storeCustomizationSchema.safeParse({ socials: { website: sito(v) } }).success;

describe('R21-016: il campo sito del negozio', () => {
  it('uno spazio nel percorso si rifiuta', () => {
    expect(valido('https://negozio.it/a b')).toBe(false);
    expect(valido('negozio.it/a b')).toBe(false);
  });
  it('«//negozio.it» non diventa «https:////negozio.it» e resta rifiutato', () => {
    expect(sito('//negozio.it')).toBe('//negozio.it');
    expect(valido('//negozio.it')).toBe(false);
  });
  it('i siti giusti passano ancora', () => {
    expect(sito('negozio.it')).toBe('https://negozio.it');
    expect(valido('https://www.negozio.it/chi-siamo')).toBe(true);
    expect(valido('www.negozio.it')).toBe(true);
  });
});
