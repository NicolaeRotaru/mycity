/**
 * Prova leggera (sorgente): le pagine del percorso d'acquisto — categorie, negozi, scheda prodotto,
 * carrello, cassa — hanno la stessa larghezza e lo stesso margine di lato nel loro contenitore principale.
 * Le caselle strette dei messaggi (errore, carrello vuoto: max-w-md/xl/2xl) non contano.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// La misura unica del percorso: 1280 px, come `--container-max` del design system, con il margine
// di lato `px-4 sm:px-6`. Le pagine scrivono le classi per intero (le prove di sorgente le cercano così).
const LARGHEZZA_PERCORSO_ACQUISTO = 'max-w-7xl';
const MARGINE_LATERALE_PERCORSO_ACQUISTO = 'px-4 sm:px-6';

const PAGINE = [
  'app/categorie/page.tsx',
  'app/stores/page.tsx',
  'app/product/[id]/page.tsx',
  'app/cart/page.tsx',
  'app/checkout/page.tsx',
];

function contenitoriPrincipali(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  return [...src.matchAll(/className="(container mx-auto [^"]*)"/g)]
    .map((m) => m[1])
    .filter((c) => !/\bmax-w-(xs|sm|md|lg|xl|2xl|3xl|4xl)\b/.test(c) && !/\btext-center\b/.test(c));
}

describe('lo stesso contenitore lungo il percorso d\'acquisto', () => {
  for (const file of PAGINE) {
    it(`${file}: ogni contenitore principale ha la stessa larghezza e lo stesso margine`, () => {
      const c = contenitoriPrincipali(file);
      expect(c.length, 'nessun contenitore principale trovato').toBeGreaterThan(0);
      for (const classi of c) {
        const parole = classi.split(/\s+/);
        expect(parole, classi).toContain(LARGHEZZA_PERCORSO_ACQUISTO);
        for (const m of MARGINE_LATERALE_PERCORSO_ACQUISTO.split(' ')) expect(parole, classi).toContain(m);
        expect(parole.filter((p) => /^max-w-/.test(p)), classi).toEqual([LARGHEZZA_PERCORSO_ACQUISTO]);
      }
    });
  }
});
