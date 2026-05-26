import { describe, it, expect } from 'vitest';
import { haversineKm, riderFee, deliveryEtaMinutes, formatEtaWindow } from '@/lib/geo';

/**
 * Unit test puri per lib/geo — calcoli geografici, fee rider, ETA.
 * Senza network / DB / Supabase. Eseguibili in <50ms.
 */

describe('haversineKm', () => {
  it('returns 0 for identical coordinates', () => {
    expect(haversineKm(45, 9, 45, 9)).toBeCloseTo(0, 5);
  });

  it('approx 111 km for 1 degree latitude difference', () => {
    // Da Piacenza (45.05) a Cremona (45.13) = ~10 km
    const d = haversineKm(45.0, 9.0, 46.0, 9.0);
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(112);
  });

  it('Piacenza centro to Borgo Faxhall (~2 km)', () => {
    const d = haversineKm(45.0526, 9.6929, 45.0470, 9.6850);
    expect(d).toBeGreaterThan(0.5);
    expect(d).toBeLessThan(2);
  });

  it('handles negative coordinates (Southern hemisphere)', () => {
    const d = haversineKm(-45, -90, -45.5, -89.5);
    expect(d).toBeGreaterThan(0);
  });

  it('is commutative', () => {
    const a = haversineKm(45.05, 9.7, 45.10, 9.75);
    const b = haversineKm(45.10, 9.75, 45.05, 9.7);
    expect(a).toBeCloseTo(b, 6);
  });
});

describe('riderFee', () => {
  it('base fee for 0 km', () => {
    expect(riderFee(0)).toBe(2.5);
  });

  it('base + per_km * distance', () => {
    // 2.5 + 1.2 * 5 = 8.5
    expect(riderFee(5)).toBe(8.5);
  });

  it('rounds to nearest 0.1', () => {
    // 2.5 + 1.2 * 1.23 = 3.976 → 4.0
    expect(riderFee(1.23)).toBe(4);
  });

  it('clamps negative distance to 0', () => {
    expect(riderFee(-5)).toBe(2.5);
  });

  it('scales linearly', () => {
    const fee10 = riderFee(10);
    const fee20 = riderFee(20);
    expect(fee20 - fee10).toBeCloseTo(12, 1);
  });
});

describe('deliveryEtaMinutes', () => {
  it('default prep 15 min for 0 km', () => {
    expect(deliveryEtaMinutes(0)).toBe(15);
  });

  it('5 km @ 25 km/h = 12 min travel + 15 prep = 27 min', () => {
    expect(deliveryEtaMinutes(5)).toBe(27);
  });

  it('custom prep time', () => {
    expect(deliveryEtaMinutes(0, 30)).toBe(30);
  });

  it('rounds to integer minutes', () => {
    const result = deliveryEtaMinutes(3.7);
    expect(Number.isInteger(result)).toBe(true);
  });
});

describe('formatEtaWindow', () => {
  it('returns ~N min format for < 60 min', () => {
    const base = new Date('2026-05-26T12:00:00');
    const result = formatEtaWindow(30, base);
    expect(result).toContain('~30 min');
    expect(result).toContain('12:30');
  });

  it('returns hour-only format for >= 60 min', () => {
    const base = new Date('2026-05-26T12:00:00');
    const result = formatEtaWindow(90, base);
    expect(result).toBe('entro le 13:30');
  });

  it('handles midnight crossover', () => {
    const base = new Date('2026-05-26T23:30:00');
    const result = formatEtaWindow(60, base);
    expect(result).toContain('00:30');
  });
});
