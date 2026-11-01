import { describe, it, expect } from 'vitest';
import { scadenzaDelRecesso } from '@/app/orders/[id]/return/regole-del-modulo';

/**
 * Regola di Nicola: il recesso dura 14 giorni di calendario a Roma, fino alle
 * 23:59:59 del 14esimo giorno. Non 14x24 ore dall'ora della consegna.
 * Consegna lunedi' 2/11/2026 alle 10:00 (ora di Roma).
 */
const consegna = { delivered_at: '2026-11-02T10:00:00+01:00' };

describe('il recesso dura fino a mezzanotte del 14esimo giorno, a Roma', () => {
  it('lun 16/11 alle 18:00: ancora dentro', () => {
    expect(scadenzaDelRecesso(consegna, new Date('2026-11-16T18:00:00+01:00')).scaduto).toBe(false);
  });

  it('lun 16/11 alle 23:59:59: ancora dentro', () => {
    expect(scadenzaDelRecesso(consegna, new Date('2026-11-16T23:59:59+01:00')).scaduto).toBe(false);
  });

  it('stessa cosa scritta in UTC (09:00Z → 17:00Z)', () => {
    expect(
      scadenzaDelRecesso({ delivered_at: '2026-11-02T09:00:00Z' }, Date.parse('2026-11-16T17:00:00Z')).scaduto,
    ).toBe(false);
  });

  it('mar 17/11 alle 00:00:00: scaduto', () => {
    const r = scadenzaDelRecesso(consegna, new Date('2026-11-17T00:00:00+01:00'));
    expect(r.scaduto).toBe(true);
    expect(r.giorniPassati).toBe(15);
  });

  it('consegna alle 23:30 di Roma: la scadenza resta la mezzanotte del 16/11', () => {
    // 2/11 23:30 Roma = 22:30Z del 2/11; il 16/11 alle 23:00 Roma e' ancora dentro, il 17/11 alle 00:10 no.
    const tardi = { delivered_at: '2026-11-02T22:30:00Z' };
    expect(scadenzaDelRecesso(tardi, new Date('2026-11-16T23:00:00+01:00')).scaduto).toBe(false);
    expect(scadenzaDelRecesso(tardi, new Date('2026-11-17T00:10:00+01:00')).scaduto).toBe(true);
  });

  it('consegna alle 00:30 di Roma (ancora il giorno prima in UTC) conta dal giorno di Roma', () => {
    // 3/11 00:30 Roma = 2/11 23:30Z: la scadenza e' il 17/11 a mezzanotte, non il 16/11.
    const notte = { delivered_at: '2026-11-02T23:30:00Z' };
    expect(scadenzaDelRecesso(notte, new Date('2026-11-17T20:00:00+01:00')).scaduto).toBe(false);
  });
});
