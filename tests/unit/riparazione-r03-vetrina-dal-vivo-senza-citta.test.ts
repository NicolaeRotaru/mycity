import { describe, it, expect } from 'vitest';
import * as riquadro from '@/components/LiveActivityFeed';

/**
 * R03-009 (parte del riquadro) — Quello che il cliente scrive nel campo «Città» non compare
 * nel riquadro dal vivo della home. La vista non lo dà più (migrazione 271, prova SQL
 * tests/sql/rls/riparazione-r03-vetrina-senza-citta-del-cliente.test.sql); il riquadro scrive
 * comunque sempre «Qualcuno a Piacenza», anche se una vista vecchia mandasse il testo libero.
 */
describe('R03-009 — il riquadro dal vivo non scrive il testo del cliente', () => {
  it('«Quarto, via Verdi 10 citofono Rossi» diventa «Qualcuno a Piacenza»', () => {
    const chi = (riquadro as Record<string, unknown>).chiHaOrdinato as ((c: string | null) => string) | undefined;
    expect(typeof chi, 'il riquadro non dice come presenta chi ha ordinato').toBe('function');
    expect(chi!('Quarto, via Verdi 10 citofono Rossi')).toBe('Qualcuno a Piacenza');
    expect(chi!(null)).toBe('Qualcuno a Piacenza');
  });
});
