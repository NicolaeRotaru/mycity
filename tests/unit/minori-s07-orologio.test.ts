import { describe, expect, it } from 'vitest';
import { ultimiGiorniPiacenza } from '@/lib/tempo-piacenza';

describe('S07 · le giornate di Piacenza attorno al cambio d\'ora', () => {
  it('lunedì 30/3 alle 00:30: sette giorni di fila, domenica 29 compresa', () => {
    expect(ultimiGiorniPiacenza(7, new Date('2026-03-29T22:30:00Z'))).toEqual([
      '2026-03-24', '2026-03-25', '2026-03-26', '2026-03-27', '2026-03-28', '2026-03-29', '2026-03-30',
    ]);
  });
  it('domenica 25/10 alle 23:30: il 25 compare una volta sola', () => {
    const g = ultimiGiorniPiacenza(7, new Date('2026-10-25T22:30:00Z'));
    expect(g).toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
  });
  it('a cavallo della mezzanotte e del cambio di mese', () => {
    expect(ultimiGiorniPiacenza(3, new Date('2026-02-28T23:10:00Z'))).toEqual(['2026-02-27', '2026-02-28', '2026-03-01']);
  });
});
