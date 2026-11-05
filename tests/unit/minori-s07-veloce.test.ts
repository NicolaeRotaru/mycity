import { describe, expect, it } from 'vitest';
import { CONSEGNA_ALL_ORA_CHE_SCEGLI, CONSEGNA_O_VELOCE_ADESSO, rigaConsegnaDellaScheda } from '@/lib/promessa-consegna';

const tutti = [['08:00', '23:00']];
const BAR = { mon: tutti, tue: tutti, wed: tutti, thu: tutti, fri: tutti, sat: tutti, sun: tutti };

describe('S07 · la scheda prodotto non promette la veloce fuori dalle sue ore', () => {
  it('venerdì 30/10 alle 21:10, negozio aperto fino alle 23, sì della cassa arrivato alle 20:50', () => {
    const riga = rigaConsegnaDellaScheda({ esaurito: false, orari: BAR, adesso: new Date(2026, 9, 30, 21, 10), veloce: true });
    expect(riga).toBe(CONSEGNA_ALL_ORA_CHE_SCEGLI);
  });
  it('alle 20:50 lo stesso sì vale', () => {
    const riga = rigaConsegnaDellaScheda({ esaurito: false, orari: BAR, adesso: new Date(2026, 9, 30, 20, 50), veloce: true });
    expect(riga).toBe(CONSEGNA_O_VELOCE_ADESSO);
  });
});
