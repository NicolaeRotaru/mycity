/**
 * R01-002 · R01-024 — La scala del testo (app/globals.css: 10/12/14/16/18/20/24/30/36/48/60) si
 * aggirava con misure a mano, `text-[Npx]`. Nei file di R01 ogni misura a mano adesso usa il gradino
 * della scala: 10 → `text-2xs` (lo stesso numero), 11 → `text-xs` (la regola di R02-012: 11 non è un
 * gradino e si sale al 12 per non rimpicciolire), 12,5 → `text-xs` (il gradino più vicino),
 * 13 → `text-sm` (a metà strada si sale, come R24-021).
 *
 * Cricchetto limitato ai file di R01 (non a tutto il deposito): i rami paralleli delle altre sessioni
 * toccano altri file e non devono diventare rossi per questa prova. Prova sul sorgente, dichiarata:
 * le classi di Tailwind non si vedono in jsdom. Le righe di commento non contano.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const FILE_DI_R01 = [
  'components/seller/SellerShell.tsx',
  'app/rider/earnings/page.tsx',
  'app/search/page.tsx',
  'components/admin/AdminSidebar.tsx',
  'components/ProductCard.tsx',
  'components/Navbar.tsx',
  'app/admin/disputes/page.tsx',
  'app/seller/stories/page.tsx',
  'app/novita/page.tsx',
  'app/piccoli-prezzi/page.tsx',
  'app/piu-venduti/page.tsx',
];

const senzaCommenti = (file: string) =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter((r) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(r))
    .join('\n');

describe('R01-002 · R01-024 — nei file di R01 la scala del testo non si aggira', () => {
  it.each(FILE_DI_R01)('%s: nessuna misura del testo scritta a mano (text-[…])', (file) => {
    const aMano = [...senzaCommenti(file).matchAll(/(?:[a-z0-9]+:)*text-\[[0-9.]+(?:px|rem|em)\]/g)].map((m) => m[0]);
    expect(aMano).toEqual([]);
  });

  it('i gradini usati ci sono davvero: nella scala dichiarata e in Tailwind (2xs è aggiunto a mano)', () => {
    const css = readFileSync('app/globals.css', 'utf8');
    expect(css).toMatch(/--text-2xs:\s*0\.625rem;\s*\/\* 10px \*\//);
    expect(css).toMatch(/--text-xs:\s*0\.75rem;\s*\/\* 12px \*\//);
    expect(css).toMatch(/--text-sm:\s*0\.875rem;\s*\/\* 14px \*\//);
    const tailwind = readFileSync('tailwind.config.ts', 'utf8');
    expect(tailwind).toMatch(/'2xs':\s*'0\.625rem'/);
  });
});
