import { describe, it, expect, afterEach, vi } from 'vitest';
import { formatDate } from '@/lib/format';

// R16-008: formatDate (lib/format.ts) deve scrivere il giorno di Piacenza, non quello di Greenwich.
describe('R16-008 formatDate usa il giorno di Roma', () => {
  afterEach(() => vi.useRealTimers());

  it('un istante UTC alle 22:30 di agosto e gia il giorno dopo a Piacenza', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-03T12:00:00Z'));
    expect(formatDate('2026-08-03T22:30:00Z')).toBe('4 agosto 2026');
  });

  it('d inverno 23:30 UTC e gia il giorno dopo (un ora avanti)', () => {
    expect(formatDate(new Date('2026-12-31T23:30:00Z'))).toBe('1 gennaio 2027');
  });

  it('a mezzogiorno il giorno resta lo stesso', () => {
    expect(formatDate('2026-08-03T12:00:00Z')).toBe('3 agosto 2026');
  });
});
