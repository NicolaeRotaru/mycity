import { describe, it, expect } from 'vitest';
import {
  giornoPiacenza,
  primoDelMesePiacenza,
  oraPiacenza,
  inizioGiornoPiacenza,
  ultimiGiorniPiacenza,
} from '@/lib/tempo-piacenza';

/**
 * Le pagine dei numeri costruivano le chiavi dei giorni con
 * `new Date().toISOString().slice(0, 10)`, che è sempre la data di Greenwich.
 *
 * D'estate l'Italia è due ore avanti. Un ordine dell'1 agosto alle 00:30 di
 * Piacenza, per quel calcolo, è del 31 luglio: cambia giorno, cambia settimana,
 * e il primo del mese cambia perfino mese. Il voto per il negozio del mese
 * finiva così in un mese e veniva cercato nell'altro: non veniva mai contato.
 *
 * Ogni prova qui sotto diventa rossa se si torna a `toISOString()`.
 */

// Mezzanotte e mezza dell'1 agosto a Piacenza = 22:30 del 31 luglio a Greenwich.
const NOTTE_PRIMO_AGOSTO = new Date('2026-07-31T22:30:00Z');

describe('il giorno è quello di Piacenza, non di Greenwich', () => {
  it('mezzanotte e mezza del primo agosto è ancora il primo agosto', () => {
    expect(giornoPiacenza(NOTTE_PRIMO_AGOSTO)).toBe('2026-08-01');
    // Il calcolo vecchio dava questo, ed è il difetto:
    expect(NOTTE_PRIMO_AGOSTO.toISOString().slice(0, 10)).toBe('2026-07-31');
  });

  it('il mese del voto è agosto, non luglio', () => {
    expect(primoDelMesePiacenza(NOTTE_PRIMO_AGOSTO)).toBe('2026-08-01');
  });

  it("l'ora è quella del negozio", () => {
    expect(oraPiacenza(NOTTE_PRIMO_AGOSTO)).toBe(0);
    expect(oraPiacenza(new Date('2026-08-01T16:10:00Z'))).toBe(18);
  });

  it("d'inverno lo scarto è di un'ora sola", () => {
    // 23:30 del 31 dicembre a Greenwich = 00:30 del 1° gennaio a Piacenza.
    expect(giornoPiacenza(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01');
    expect(primoDelMesePiacenza(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01');
  });
});

describe('mezzanotte locale espressa in UTC', () => {
  it("l'inizio del 1° agosto a Piacenza è le 22:00 del 31 luglio UTC", () => {
    expect(inizioGiornoPiacenza('2026-08-01').toISOString()).toBe('2026-07-31T22:00:00.000Z');
  });

  it("l'inizio del 1° gennaio è le 23:00 del 31 dicembre UTC (ora solare)", () => {
    expect(inizioGiornoPiacenza('2027-01-01').toISOString()).toBe('2026-12-31T23:00:00.000Z');
  });
});

describe('le ultime giornate', () => {
  it('sono sette, in ordine, e finiscono con oggi', () => {
    const g = ultimiGiorniPiacenza(7, new Date('2026-08-20T10:00:00Z'));
    expect(g).toHaveLength(7);
    expect(g[6]).toBe('2026-08-20');
    expect(g[0]).toBe('2026-08-14');
  });
});
