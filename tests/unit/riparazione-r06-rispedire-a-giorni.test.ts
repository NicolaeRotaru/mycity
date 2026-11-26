import { afterEach, describe, expect, it, vi } from 'vitest';
import { percheIlRecessoNonSiChiude } from '@/lib/rimborsi/regole-del-rimborso';

/**
 * R06 — I 14 giorni per rispedire la merce del recesso si contano a giorni di
 * calendario a Piacenza, non a blocchi di 24 ore. Il caso scelto sta a cavallo
 * del cambio d'ora d'autunno (domenica 25/10/2026): approvazione martedì
 * 20/10/2026 alle 10:00 (ora legale), quattordicesimo giorno martedì 3/11/2026.
 */
const approvatoIl = '2026-10-20T08:00:00.000Z'; // 10:00 CEST di martedì 20/10/2026

const reso = {
  reason: 'CHANGED_MIND',
  status: 'APPROVED',
  created_at: '2026-10-19T16:00:00.000Z',
  decided_at: approvatoIl,
};

/** Il motivo per cui il negozio non può chiudere; «si chiude» se può. */
function alle(istante: string): string {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(istante));
  return percheIlRecessoNonSiChiude(reso, Date.now()) ?? 'si chiude';
}

afterEach(() => {
  vi.useRealTimers();
});

describe('i 14 giorni per rispedire, dopo il cambio d\'ora', () => {
  it('martedì 3/11/2026 alle 12:00 (quattordicesimo giorno) il negozio non chiude ancora', () => {
    // 14 × 24 ore dall'approvazione scadono alle 09:00 CET del 3/11: con quel
    // conto alle 12:00 il recesso si chiudeva, in pieno quattordicesimo giorno.
    expect(alle('2026-11-03T11:00:00.000Z')).toMatch(/14 giorni/);
  });

  it('martedì 3/11/2026 alle 09:30, mezz\'ora dopo i 14 × 24 ore, non si chiude', () => {
    expect(alle('2026-11-03T08:30:00.000Z')).toMatch(/14 giorni/);
  });

  it('martedì 3/11/2026 alle 23:59 è ancora il quattordicesimo giorno', () => {
    expect(alle('2026-11-03T22:59:00.000Z')).toMatch(/14 giorni/);
  });

  it('mercoledì 4/11/2026 alle 00:01, finito il quattordicesimo giorno, si chiude', () => {
    expect(alle('2026-11-03T23:01:00.000Z')).toBe('si chiude');
  });
});
