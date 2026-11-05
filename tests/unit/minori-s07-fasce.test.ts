import { describe, expect, it } from 'vitest';
import { sottotitoloOggiSpento, fasceAncoraPossibili } from '@/lib/quando-arriva';

const giorno = [['09:00', '13:00'], ['16:30', '19:30']];
const PANE = { mon: giorno, tue: giorno, wed: giorno, thu: [['09:00', '13:00']], fri: giorno, sat: giorno, sun: [] };
const ora = (gg: number, h: number, m = 0) => new Date(2026, 10, gg, h, m); // novembre 2026, orologio di Roma

describe('S07 · la tessera «Oggi» non dice «Negozio chiuso» a negozio aperto', () => {
  it('lunedì 2/11 alle 19:20: forno aperto fino alle 19:30, ma per oggi non c\'è più tempo', () => {
    expect(fasceAncoraPossibili(ora(2, 19, 20), [PANE])).toEqual([]);
    expect(sottotitoloOggiSpento(ora(2, 19, 20), [PANE])).toBe('Non più oggi');
  });
  it('giovedì 5/11 alle 14:00: il forno è chiuso davvero', () => {
    expect(fasceAncoraPossibili(ora(5, 14), [PANE])).toEqual([]);
    expect(sottotitoloOggiSpento(ora(5, 14), [PANE])).toBe('Negozio chiuso');
  });
  it('a mezzanotte passata non resta niente per oggi', () => {
    expect(sottotitoloOggiSpento(ora(3, 23, 59), [PANE])).toBe('Non più oggi');
  });
});
