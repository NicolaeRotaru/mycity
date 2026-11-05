import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as costanti from '@/lib/constants';

const FILE = [
  'lib/constants.ts', 'lib/shipping.ts', 'lib/ordini/prezzi.ts', 'lib/geocodifica.ts', 'lib/shipping-coordinate.ts',
  'app/api/orders/cod/route.ts', 'app/api/stripe/checkout/route.ts', 'app/checkout/page.tsx', 'lib/promesse-pubbliche.ts',
];

describe('S07 · le note dei conti dicono la regola di oggi', () => {
  it('nessuna nota parla più di «tariffa fissa» o di consegna che «copre il compenso da sola»', () => {
    for (const f of FILE) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/tariffa fissa/);
      expect(src, f).not.toMatch(/copre il compenso da sola/);
      expect(src, f).not.toMatch(/per negozio, sempre/);
    }
  });
  it('la costante «massima» che non era un massimo non esiste più', () => {
    expect('CONSEGNA_MASSIMA_CENTS' in costanti).toBe(false);
  });
});

describe('S07 · una versione sola su come si chiude un ritiro', () => {
  it('la nota dell\'interruttore non dice più che manca la via del venditore', () => {
    const src = readFileSync('lib/ritiro-in-negozio.ts', 'utf8');
    expect(src).not.toMatch(/il solo modo di\s*\n?\s*\*?\s*chiudere un ordine e' il bottone del fattorino/);
    expect(src).toMatch(/confirm_pickup_by_seller/);
  });
});
