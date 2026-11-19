/**
 * R09-014 — «Fino al 6/11» scade a mezzanotte di Piacenza, qualunque sia il fuso di chi esegue
 * il codice (server in UTC, browser in Italia o altrove): niente più annuncio scaduto
 * visibile fra le 00:00 e l'una (le due d'estate) del giorno dopo.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { announcementActive } from '@/lib/store-customization';

const annuncio = (until: string) => ({ announcement: { enabled: true, text: 'Chiusi per ferie', until } });
const FUSI = ['UTC', 'Europe/Rome', 'America/Los_Angeles', 'Asia/Tokyo'];

let tzPrima: string | undefined;
beforeEach(() => { tzPrima = process.env.TZ; vi.useFakeTimers(); });
afterEach(() => {
  vi.useRealTimers();
  if (tzPrima === undefined) delete process.env.TZ; else process.env.TZ = tzPrima;
});

describe.each(FUSI)('con il fuso del processo %s', (tz) => {
  beforeEach(() => { process.env.TZ = tz; });

  it('inverno: alle 00:30 del 7/11 a Piacenza l\'annuncio «fino al 6/11» è scaduto', () => {
    vi.setSystemTime(new Date('2026-11-06T23:30:00Z')); // 00:30 del 7 a Piacenza (UTC+1)
    expect(announcementActive(annuncio('2026-11-06'))).toBe(false);
  });
  it('inverno: alle 23:30 del 6/11 a Piacenza è ancora attivo', () => {
    vi.setSystemTime(new Date('2026-11-06T22:30:00Z')); // 23:30 del 6 a Piacenza
    expect(announcementActive(annuncio('2026-11-06'))).toBe(true);
  });
  it('estate: alle 00:30 del 7/7 a Piacenza (22:30 UTC del 6) è scaduto', () => {
    vi.setSystemTime(new Date('2026-07-06T22:30:00Z')); // UTC+2
    expect(announcementActive(annuncio('2026-07-06'))).toBe(false);
  });
  it('estate: alle 23:30 del 6/7 a Piacenza (21:30 UTC) è ancora attivo', () => {
    vi.setSystemTime(new Date('2026-07-06T21:30:00Z'));
    expect(announcementActive(annuncio('2026-07-06'))).toBe(true);
  });
});
