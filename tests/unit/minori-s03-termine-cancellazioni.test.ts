import { describe, it, expect } from 'vitest';
import { terminePassato, verdettoDelGiro } from '@/lib/cron-cancellazioni';

/** S03 — il termine di un mese sulle cancellazioni (scheda 97). */
const notte = (iso: string) => Date.parse(iso);

describe('il termine è un mese di calendario', () => {
  it('chiesta il 30/01 alle 11: il termine è il 28/02, scaduta dalla notte del 01/03', () => {
    const chiesta = '2027-01-30T10:00:00Z';
    expect(terminePassato(chiesta, notte('2027-02-28T03:00:00Z'))).toBe(false);
    expect(terminePassato(chiesta, notte('2027-03-01T03:00:00Z'))).toBe(true);
  });

  it('chiesta il 15/04: il termine è il 15/05, scaduta dal 16/05', () => {
    expect(terminePassato('2026-04-15T09:00:00Z', notte('2026-05-15T03:00:00Z'))).toBe(false);
    expect(terminePassato('2026-04-15T09:00:00Z', notte('2026-05-16T03:00:00Z'))).toBe(true);
  });

  it('il giorno è quello di Piacenza: chiesta il 31/10 alle 00:30 di Piacenza (30/10 in UTC)', () => {
    // 2026-10-30T23:30Z = 31/10 00:30 a Piacenza: termine 30/11 (novembre ha 30 giorni).
    expect(terminePassato('2026-10-30T23:30:00Z', notte('2026-11-30T03:00:00Z'))).toBe(false);
    expect(terminePassato('2026-10-30T23:30:00Z', notte('2026-12-01T03:00:00Z'))).toBe(true);
  });

  it('il verdetto della notte usa il mese: il rinvio del 30/01 è «scaduto» il 01/03', () => {
    const v = verdettoDelGiro(
      [{ userId: 'r1', ok: false, motivo: 'cassa_da_versare', errore: 'rinviata', chiestaIl: '2027-01-30T10:00:00Z' }],
      notte('2027-03-01T03:00:00Z'),
      'scrivi a privacy@example.it',
    );
    expect(v.scadute).toBe(1);
  });
});
