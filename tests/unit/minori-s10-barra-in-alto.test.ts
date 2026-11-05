import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { hrefDiAccesso } from '@/lib/auth/href-di-accesso';

/**
 * S10 (5/11/2026) — la barra in alto.
 * 576: «Accedi» riporta dove si era.
 * 2670: il link del carrello non prende il colore dello sfondo al tocco.
 */
describe('«Accedi» porta con sé la pagina (576)', () => {
  it('dal carrello', () => {
    expect(hrefDiAccesso('/cart', '')).toBe('/sign-in?returnTo=%2Fcart');
  });
  it('dalla cassa con i parametri', () => {
    expect(hrefDiAccesso('/checkout', '?passo=2')).toBe(`/sign-in?returnTo=${encodeURIComponent('/checkout?passo=2')}`);
  });
  it('dalla home e dalle pagine d\'accesso niente ritorno', () => {
    expect(hrefDiAccesso('/', '')).toBe('/sign-in');
    expect(hrefDiAccesso('/sign-up', '?returnTo=%2Fcart')).toBe('/sign-in');
  });
  it('la barra usa il link costruito, non /sign-in fisso', () => {
    const src = readFileSync('components/Navbar.tsx', 'utf8');
    expect(src).not.toMatch(/<Link href="\/sign-in"/);
    expect(src.match(/<Link href=\{accediHref\}/g) ?? []).toHaveLength(2);
  });
});

describe('il carrello resta bianco al tocco (2670)', () => {
  it('i due link del carrello hanno hover:text-white', () => {
    const src = readFileSync('components/Navbar.tsx', 'utf8');
    const carrelli = src.match(/<Link href="\/cart" className="[^"]*"/g) ?? [];
    expect(carrelli.length).toBeGreaterThanOrEqual(2);
    for (const c of carrelli) expect(c).toMatch(/hover:text-white/);
  });
});

describe('nessun link bianco della testata sparisce al passaggio (2439)', () => {
  it('ogni link con text-white ha anche il suo hover:text-*', () => {
    // a:hover in globals.css (0,1,1) vince su .text-white (0,1,0): senza un
    // hover:text-* il link diventa primary-800 sullo sfondo primary-700.
    const src = readFileSync('components/Navbar.tsx', 'utf8');
    const scoperti = [...src.matchAll(/<(Link|a)\b[^>]*className="([^"]*)"/g)]
      .map((m) => m[2])
      .filter((c) => /\btext-white\b/.test(c) && !/hover:text-/.test(c));
    expect(scoperti).toEqual([]);
  });
});
