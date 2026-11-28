/**
 * R09-005 — La frase della zona («fino a N km dal negozio») si scrive in un posto solo,
 * lib/ordini/zona-di-consegna.ts, e gli altri la importano. Il testo che vede il cliente
 * resta quello di prima (lo tiene fermo le-frasi-della-zona-dicono-il-confine-della-cassa).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const FONTE = 'lib/ordini/zona-di-consegna.ts';
const ALTRI = [
  'components/checkout/ShippingAddressForm.tsx',
  'app/shipping/page.tsx',
  'components/LocationPill.tsx',
  'lib/promesse-pubbliche.ts',
  'app/near/page.tsx',
];

describe('R09-005 — la frase della zona ha una fonte sola', () => {
  it('«km dal negozio» è scritto solo nella fonte, in nessuno degli altri cinque posti', () => {
    expect(readFileSync(FONTE, 'utf8')).toMatch(/fino a .{1,40} dal negozio/);
    const rifiuto = readFileSync(FONTE, 'utf8').split('export function motivoFuoriZona')[1] ?? '';
    expect(rifiuto, 'il rifiuto riscrive il confine invece di usare la frase comune').not.toMatch(/RAGGIO_CONSEGNA_KM|km dal negozio/);
    for (const f of ALTRI) {
      const righe = readFileSync(f, 'utf8')
        .split('\n')
        .filter((r) => !/^\s*(\/\/|\/\*|\*)/.test(r))
        .filter((r) => /km\}?\s+dal negozio|fino a \$\{[A-Z_]+\} km/.test(r));
      expect(righe, `${f} riscrive la frase della zona`).toEqual([]);
    }
  });
  it('ognuno degli altri la importa dalla fonte', () => {
    for (const f of ALTRI) {
      expect(readFileSync(f, 'utf8'), f).toMatch(/from '(@\/lib|\.)\/ordini\/zona-di-consegna'/);
    }
  });
});
