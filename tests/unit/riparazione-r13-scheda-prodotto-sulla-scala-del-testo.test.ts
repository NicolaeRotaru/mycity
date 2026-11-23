/**
 * La scheda prodotto (components/ProductCard.tsx) scrive il testo coi gradini della scala dichiarata
 * in app/globals.css (--text-2xs … --text-6xl), non con dimensioni a mano (text-[13px], fontSize in stile).
 * Prova leggera: legge i due file, ignorando i commenti.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const leggi = (f: string) => readFileSync(join(process.cwd(), f), 'utf8');
const senzaCommenti = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const scala = [...leggi('app/globals.css').matchAll(/--text-([0-9a-z]+)\s*:/g)].map((m) => m[1]);
const codice = senzaCommenti(leggi('components/ProductCard.tsx'));

describe('ProductCard non scavalca la scala delle dimensioni del testo', () => {
  it('la scala dichiara i gradini 2xs … 6xl', () => {
    expect(scala).toEqual(expect.arrayContaining(['2xs', 'xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl']));
  });

  it('nessuna dimensione scritta a mano: né text-[Npx]/text-[Nrem] né fontSize', () => {
    expect(codice.match(/text-\[[0-9.]+(px|rem|em)\]/g) ?? []).toEqual([]);
    expect(codice).not.toMatch(/fontSize|font-size/);
  });

  it('ogni text-<gradino> usato sta nella scala', () => {
    const usati = new Set([...codice.matchAll(/(?<![\w-])text-(2xs|xs|sm|base|lg|xl|[2-9]xl)\b/g)].map((m) => m[1]));
    expect(usati.size, 'la scheda deve usare almeno un gradino').toBeGreaterThan(0);
    for (const g of usati) expect(scala, `text-${g} non è nella scala`).toContain(g);
  });
});
