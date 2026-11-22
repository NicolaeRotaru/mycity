/**
 * R12 — LA SCALA DEL TESTO NON SI SCAVALCA NELLE SCHEDE.
 *
 * La scala delle dimensioni del testo sta in app/globals.css (e in Tailwind: text-2xs … text-6xl).
 * Una misura scritta a mano (`text-[15px]`) la scavalca: non segue i passi del design e, in pixel,
 * non cresce col testo ingrandito. Qui le schede dei prodotti e dei negozi non ne hanno più (nel
 * codice; un commento che racconta com'era non conta).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const senzaCommenti = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('R12-014 — le schede usano i passi della scala del testo', () => {
  for (const file of ['components/ProductCard.tsx', 'components/StorePreviewCard.tsx', 'components/StoreListRow.tsx']) {
    it(file, () => {
      const codice = senzaCommenti(readFileSync(file, 'utf8'));
      expect(codice, 'controprova: il file ha delle misure di testo').toMatch(/\btext-(2xs|xs|sm|base|lg|xl)\b/);
      const aMano = codice.match(/text-\[[0-9.]+(px|rem)\]/g) ?? [];
      expect(aMano, `${file} scavalca la scala del testo con misure scritte a mano`).toEqual([]);
    });
  }
});
