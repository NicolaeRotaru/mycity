import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fraseAttesaBonifico } from '@/lib/stripe/tempi-bonifico';

// R09-020 — Il riquadro «Compensi sul tuo IBAN» diceva «in arrivo» senza dire quando, e senza dire
// che senza IBAN collegato non arriva niente. Prova leggera: la frase usa la stessa fonte dei tempi
// (fraseAttesaBonifico) e nomina l'IBAN da collegare.
describe('R09-020 · i guadagni del fattorino dicono quando arriva il bonifico', () => {
  const s = readFileSync('app/rider/earnings/page.tsx', 'utf8');
  it('il riquadro usa fraseAttesaBonifico, non un tempo scritto a mano', () => {
    expect(s).toContain("import { fraseAttesaBonifico } from '@/lib/stripe/tempi-bonifico';");
    expect(s).toMatch(/Il bonifico di una consegna con carta parte \{fraseAttesaBonifico\(\)\}/);
    expect(fraseAttesaBonifico()).toMatch(/dopo la consegna/);
  });
  it('dice che senza IBAN collegato i compensi restano in attesa', () => {
    expect(s).toMatch(/solo se hai collegato il tuo IBAN/);
  });
});
