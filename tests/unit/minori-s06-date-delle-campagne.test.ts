import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dataDellaCampagna } from '@/app/seller/promote/data-campagna';

/** S06 · 1567 — Le date delle campagne si leggono all'ora di Piacenza, non del telefono. */
describe('1567 — date delle campagne', () => {
  it('la mezzanotte di Piacenza resta quel giorno anche con un telefono a New York', () => {
    const prima = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      // 3 novembre 2026, 00:30 a Piacenza = 2 novembre 23:30 UTC.
      expect(dataDellaCampagna('2026-11-02T23:30:00Z')).toBe('3 novembre 2026');
    } finally {
      process.env.TZ = prima;
    }
  });
  it('la pagina usa la data di Piacenza', () => {
    expect(readFileSync('app/seller/promote/page.tsx', 'utf8')).toContain('dataDellaCampagna(c.start_date)');
  });
});
