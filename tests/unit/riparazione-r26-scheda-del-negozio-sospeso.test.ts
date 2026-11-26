import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { orariPerLoSchema } from '@/components/store-sections/orari-schema';

const GIORNO: [string, string][] = [['08:00', '20:00']];
const APERTO_SEMPRE = { mon: GIORNO, tue: GIORNO, wed: GIORNO, thu: GIORNO, fri: GIORNO, sat: GIORNO, sun: GIORNO };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-25T10:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('la scheda pubblica', () => {
  it('un negozio sospeso non si dichiara aperto, uno che serve sì', () => {
    expect(orariPerLoSchema(APERTO_SEMPRE)).toBeDefined();
    expect(orariPerLoSchema({ ...APERTO_SEMPRE, finitoOggiIl: '2026-11-25' })).toBeUndefined();
    expect(orariPerLoSchema({ ...APERTO_SEMPRE, chiusoFinoAl: '2026-11-27' })).toBeUndefined();
    expect(orariPerLoSchema({ ...APERTO_SEMPRE, chiusoFinoAl: '2026-11-24' })).toBeDefined();
  });
});
