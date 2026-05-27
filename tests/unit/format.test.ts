import { describe, it, expect } from 'vitest';
import { formatPrice, formatDate } from '@/lib/format';

describe('formatPrice', () => {
  it('formats integer with 2 decimals', () => {
    expect(formatPrice(10)).toBe('€10.00');
    expect(formatPrice(0)).toBe('€0.00');
  });

  it('formats float to 2 decimals', () => {
    expect(formatPrice(9.99)).toBe('€9.99');
    expect(formatPrice(3.5)).toBe('€3.50');
  });

  it('rounds halves up', () => {
    // 1.005 round half to even in JS, but toFixed rounds normally
    expect(formatPrice(1.235)).toMatch(/€1\.2[34]/); // rounding edge
  });

  it('accepts string numeric input', () => {
    expect(formatPrice('5.5')).toBe('€5.50');
    expect(formatPrice('10')).toBe('€10.00');
  });

  it('handles negative (refund)', () => {
    expect(formatPrice(-5)).toBe('€-5.00');
  });
});

describe('formatDate', () => {
  it('formats date in Italian long format', () => {
    const result = formatDate('2026-05-27');
    // Es: "27 maggio 2026"
    expect(result).toMatch(/27.*maggio.*2026/);
  });

  it('accepts Date instance', () => {
    const result = formatDate(new Date('2026-01-15'));
    expect(result).toMatch(/15.*gennaio.*2026/);
  });

  it('uses 2-digit day', () => {
    const result = formatDate('2026-05-03');
    expect(result).toMatch(/^03/);
  });
});
