/**
 * R13-013 — La frase della zona («fino a N km dal negozio») viveva scritta a mano in sei posti:
 * cassa, Spedizioni, rifiuto della cassa, tendina della posizione, FAQ e «Vicino a te». Le teneva
 * allineate solo una prova (le-frasi-della-zona-dicono-il-confine-della-cassa, che guarda cosa si
 * legge a schermo). Questa guarda dove sta la frase: una volta sola, in lib/promesse-pubbliche.ts,
 * letta da RAGGIO_CONSEGNA_KM; negli altri posti nessuno la riscrive.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CASA = 'lib/promesse-pubbliche.ts';
const LETTORI = [
  'components/checkout/ShippingAddressForm.tsx', // la riga sotto il CAP in cassa
  'app/shipping/page.tsx', // la pagina Spedizioni
  'lib/ordini/zona-di-consegna.ts', // il rifiuto della cassa (motivoFuoriZona)
  'components/LocationPill.tsx', // la tendina della posizione
  'app/near/page.tsx', // «Vicino a te»
];

/** Il codice senza i commenti: un percorso o una frase citata in un commento non conta. */
function codice(file: string): string {
  return readFileSync(join(process.cwd(), file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const volte = (testo: string, cosa: RegExp) => [...testo.matchAll(cosa)].length;

describe('R13-013 · la frase della zona sta in un posto solo', () => {
  it('lib/promesse-pubbliche.ts la scrive una volta, col confine letto da RAGGIO_CONSEGNA_KM (anche per le FAQ)', () => {
    const src = codice(CASA);
    expect(volte(src, /km dal negozio/g), 'la frase è riscritta più volte dentro le promesse pubbliche').toBe(1);
    expect(src).toContain('fino a ${RAGGIO_CONSEGNA_KM} km dal negozio');
  });

  for (const file of LETTORI) {
    it(`${file} la legge da lib/promesse-pubbliche.ts e non la riscrive`, () => {
      const src = codice(file);
      expect(volte(src, /km dal negozio/g), `${file} scrive ancora a mano «… km dal negozio»`).toBe(0);
      expect(src, `${file} compone la frase a pezzi («fino a … dal negozio»)`).not.toMatch(/fino a[^`'"\n]{0,60}dal negozio/);
      expect(src, `${file} non legge niente da lib/promesse-pubbliche.ts`).toMatch(/from '@\/lib\/promesse-pubbliche'/);
    });
  }
});
