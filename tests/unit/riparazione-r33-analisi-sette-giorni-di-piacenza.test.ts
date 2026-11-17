import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inizioGiornoPiacenza, ultimiGiorniPiacenza } from '@/lib/tempo-piacenza';

/**
 * R33-021 — la cifra «ultimi 7 giorni» e le sette barre dell'analisi contano gli stessi giorni:
 * le sette giornate di Piacenza, dalla mezzanotte di sei giorni fa, non le ultime 168 ore.
 */
afterEach(() => vi.useRealTimers());

const sorgente = readFileSync(join(process.cwd(), 'app', 'seller', 'analytics', 'page.tsx'), 'utf8');

describe('R33-021 — taglio dei «7 giorni»', () => {
  it('la pagina ricava il taglio dalle giornate di Piacenza, non da Date.now() - 7 giorni', () => {
    expect(sorgente).not.toMatch(/since7\s*=\s*new Date\(Date\.now\(\)\s*-\s*7/);
    expect(sorgente).toMatch(/since7\s*=\s*inizioGiornoPiacenza\(ultimiGiorniPiacenza\(7\)\[0\]\)/);
  });

  it('il taglio con orologio finto è la mezzanotte di Piacenza di sei giorni fa', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-17T15:30:00Z'));
    const taglio = inizioGiornoPiacenza(ultimiGiorniPiacenza(7)[0]);
    expect(taglio.toISOString()).toBe('2026-11-10T23:00:00.000Z');
    // le 168 ore prima partirebbero otto ore prima, cioè con un pezzo di giorno in più
    expect(Date.now() - 7 * 86400000).toBeLessThan(taglio.getTime());
  });
});
