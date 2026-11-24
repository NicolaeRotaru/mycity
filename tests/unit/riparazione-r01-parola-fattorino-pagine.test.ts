// R01-008 — le pagine dell'ordine (cliente) e dell'ordine del negozio dicono «fattorino» nelle stringhe mostrate.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const leggi = (...p: string[]) => readFileSync(join(process.cwd(), ...p), 'utf8');

// Solo il testo mostrato: tolgo i commenti, poi guardo le parole «rider» da sole (non rider_id, riderPhase…).
const testoMostrato = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/import .*$/gm, '');
const rider = (src: string) => testoMostrato(src).match(/(?<![\w.])[Rr]ider(?![\w])(?!\??\.)(?!\s*[:&?])/g) ?? [];

describe('R01-008 «fattorino» nelle pagine dell\'ordine', () => {
  it('la pagina dell\'ordine del cliente non dice più «rider» nei testi', () => {
    const src = leggi('app', 'orders', '[id]', 'page.tsx');
    expect(rider(src)).toEqual([]);
    expect(src).toContain("'Il tuo fattorino'");
    expect(src).toContain('in contanti al fattorino alla consegna');
  });

  it('la pagina dell\'ordine del negozio non dice più «rider» nei testi', () => {
    const src = leggi('app', 'seller', 'orders', '[id]', 'page.tsx');
    expect(rider(src)).toEqual([]);
    expect(src).toContain('In attesa che un fattorino prenda in carico');
    expect(src).toContain('Il fattorino incassa');
  });
});
