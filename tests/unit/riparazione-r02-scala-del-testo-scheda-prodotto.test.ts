/**
 * R02-012 (onda 9) — LA SCHEDA PRODOTTO NON SCAVALCA PIÙ LA SCALA DEL TESTO.
 *
 * La scala dichiarata (app/globals.css, 10/12/14/16/18/20/24/30/36/48/60) si aggirava con misure a
 * mano. In `components/ProductCard.tsx` restavano due `text-[11px]` (il nome del negozio e il
 * prezzo barrato): 11 non è un gradino, e stanno a un pixel da 10 e da 12; si sale al 12
 * (`text-xs`) per non rimpicciolire un testo che si legge già a fatica.
 * Prova sul sorgente, dichiarata: le classi di Tailwind non si vedono in jsdom.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const codice = readFileSync('components/ProductCard.tsx', 'utf8')
  .split('\n')
  .filter((r) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(r))
  .join('\n');

describe('R02-012 — la scheda prodotto usa solo i gradini della scala del testo', () => {
  it('nessuna misura del testo scritta a mano (text-[…])', () => {
    const aMano = [...codice.matchAll(/(?:[a-z0-9]+:)*text-\[[0-9.]+(?:px|rem|em)\]/g)].map((m) => m[0]);
    expect(aMano).toEqual([]);
  });

  it('il nome del negozio e il prezzo barrato sono al gradino da 12 (text-xs)', () => {
    expect(codice).toMatch(/<span className="truncate text-xs font-semibold text-ink-500">\{storeName\}<\/span>/);
    expect(codice).toMatch(/<s className="text-xs text-ink-500">/);
  });

  it('il gradino da 12 c\'è davvero nella scala dichiarata', () => {
    const css = readFileSync('app/globals.css', 'utf8');
    expect(css).toMatch(/--text-xs:\s*0\.75rem;\s*\/\* 12px \*\//);
  });
});
