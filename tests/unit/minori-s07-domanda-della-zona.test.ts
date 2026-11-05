import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { domandaDellaZona } from '@/components/checkout/ShippingAddressForm';

/** La frase del server, presa dal sorgente di lib/geocodifica.ts ed eseguita sugli stessi campi. */
function domandaDelServer(ind: { address: string; city: string; zip: string }): string {
  const src = readFileSync('lib/geocodifica.ts', 'utf8');
  const m = src.match(/const q = (`[^`]*`[^;]*);/);
  if (!m) throw new Error('la frase del server non si trova più in lib/geocodifica.ts');
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function('indirizzo', `return ${m[1]};`)(ind) as string;
}

describe('S07 · cassa e server fanno alle mappe la stessa domanda', () => {
  for (const ind of [
    { address: 'Via Roma 1', city: 'Piacenza', zip: '29121' },
    { address: 'Via  Roma 1 ', city: ' Piacenza', zip: '29121 ' },
    { address: '  Corso Vittorio Emanuele II, 5', city: 'Piacenza  ', zip: '' },
  ]) {
    it(JSON.stringify(ind), () => {
      expect(domandaDellaZona(ind)).toBe(domandaDelServer(ind));
    });
  }
});
