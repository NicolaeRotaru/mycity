import { describe, it, expect } from 'vitest';
import {
  isOpenNow,
  formatToday,
  streetFromAddress,
  DAY_KEYS,
} from '@/lib/store-hours';

/**
 * Unit test per lib/store-hours: aperto/chiuso, format apertura.
 *
 * Esperti: Senior PM: "Bug in store-hours = utente vede 'aperto' ma negozio
 * chiuso. Bad UX + lost trust. Test ogni edge case: midnight, multi-interval."
 */

const mkDate = (h: number, m = 0) => {
  const d = new Date('2026-05-27T00:00:00');
  d.setHours(h, m, 0, 0);
  return d;
};

describe('DAY_KEYS', () => {
  it('starts with sunday and has 7 days', () => {
    expect(DAY_KEYS).toEqual(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
    expect(DAY_KEYS).toHaveLength(7);
  });
});

describe('streetFromAddress', () => {
  it('extracts first comma-separated piece', () => {
    expect(streetFromAddress('Via Roma 1, Piacenza, 29100')).toBe('Via Roma 1');
  });

  it('handles single segment', () => {
    expect(streetFromAddress('Via Roma 1')).toBe('Via Roma 1');
  });

  it('returns null for null/empty', () => {
    expect(streetFromAddress(null)).toBeNull();
    expect(streetFromAddress(undefined)).toBeNull();
    expect(streetFromAddress('')).toBeNull();
    expect(streetFromAddress('   ')).toBeNull();
  });

  it('trims whitespace', () => {
    expect(streetFromAddress('  Via Roma 1  , Piacenza')).toBe('Via Roma 1');
  });
});

describe('isOpenNow - single interval', () => {
  const intervals: [string, string][] = [['09:00', '13:00']];

  it('returns true when current time is inside interval', () => {
    expect(isOpenNow(intervals, mkDate(10))).toBe(true);
    expect(isOpenNow(intervals, mkDate(12, 59))).toBe(true);
  });

  it('returns true at opening time (inclusive)', () => {
    expect(isOpenNow(intervals, mkDate(9, 0))).toBe(true);
  });

  it('returns false at closing time (exclusive)', () => {
    expect(isOpenNow(intervals, mkDate(13, 0))).toBe(false);
  });

  it('returns false before opening', () => {
    expect(isOpenNow(intervals, mkDate(8, 59))).toBe(false);
  });

  it('returns false after closing', () => {
    expect(isOpenNow(intervals, mkDate(13, 1))).toBe(false);
    expect(isOpenNow(intervals, mkDate(20))).toBe(false);
  });
});

describe('isOpenNow - multi-interval (pranzo + cena)', () => {
  const intervals: [string, string][] = [
    ['12:00', '14:30'],
    ['19:00', '22:30'],
  ];

  it('open during pranzo', () => {
    expect(isOpenNow(intervals, mkDate(13))).toBe(true);
  });

  it('open during cena', () => {
    expect(isOpenNow(intervals, mkDate(20, 30))).toBe(true);
  });

  it('closed between pranzo and cena', () => {
    expect(isOpenNow(intervals, mkDate(15))).toBe(false);
    expect(isOpenNow(intervals, mkDate(18, 30))).toBe(false);
  });

  it('closed before pranzo', () => {
    expect(isOpenNow(intervals, mkDate(10))).toBe(false);
  });

  it('closed after cena', () => {
    expect(isOpenNow(intervals, mkDate(23))).toBe(false);
  });
});

describe('isOpenNow - edge cases', () => {
  it('returns false for empty intervals', () => {
    expect(isOpenNow([], mkDate(10))).toBe(false);
    expect(isOpenNow(undefined, mkDate(10))).toBe(false);
  });
});

describe('formatToday', () => {
  const intervals: [string, string][] = [['09:00', '13:00'], ['16:00', '19:00']];

  it('says "Aperto fino alle X" during interval', () => {
    expect(formatToday(intervals, mkDate(10))).toBe('Aperto fino alle 13:00');
    expect(formatToday(intervals, mkDate(17))).toBe('Aperto fino alle 19:00');
  });

  it('says "Apre alle X" before first opening', () => {
    expect(formatToday(intervals, mkDate(7))).toBe('Apre alle 09:00');
  });

  it('says "Apre alle X" between intervals', () => {
    expect(formatToday(intervals, mkDate(14))).toBe('Apre alle 16:00');
  });

  it('says "Chiuso ora" after last interval', () => {
    expect(formatToday(intervals, mkDate(20))).toBe('Chiuso ora');
  });

  it('says "Chiuso oggi" for empty/no intervals', () => {
    expect(formatToday(undefined, mkDate(10))).toBe('Chiuso oggi');
    expect(formatToday([], mkDate(10))).toBe('Chiuso oggi');
  });
});
