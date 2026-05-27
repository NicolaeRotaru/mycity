import { describe, it, expect, beforeEach } from 'vitest';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

/**
 * Unit test per lib/rate-limit (in-memory sliding window).
 *
 * Esperti: SRE: "Rate limit = primo strato difesa contro bot. Bug qui =
 * marketplace down per spam. Test ogni edge: race, gc, key isolation."
 */

describe('rateLimit - basic allow/deny', () => {
  beforeEach(() => {
    // Pulisce buckets in-memory: chiave random per test isolation
  });

  it('allows requests under limit', () => {
    const key = `test-allow-${Math.random()}`;
    for (let i = 0; i < 5; i++) {
      const result = rateLimit({ key, max: 10, windowMs: 60_000 });
      expect(result.allowed).toBe(true);
    }
  });

  it('denies when limit hit', () => {
    const key = `test-deny-${Math.random()}`;
    for (let i = 0; i < 3; i++) {
      rateLimit({ key, max: 3, windowMs: 60_000 });
    }
    const result = rateLimit({ key, max: 3, windowMs: 60_000 });
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterSec).toBeGreaterThan(0);
  });

  it('returns correct remaining count', () => {
    const key = `test-remaining-${Math.random()}`;
    rateLimit({ key, max: 5, windowMs: 60_000 });
    rateLimit({ key, max: 5, windowMs: 60_000 });
    const result = rateLimit({ key, max: 5, windowMs: 60_000 });
    expect(result.remaining).toBe(2); // 5 - 3 = 2
  });

  it('isolates buckets by key', () => {
    const key1 = `test-iso-1-${Math.random()}`;
    const key2 = `test-iso-2-${Math.random()}`;

    // Esaurisci key1
    for (let i = 0; i < 3; i++) {
      rateLimit({ key: key1, max: 3, windowMs: 60_000 });
    }
    expect(rateLimit({ key: key1, max: 3, windowMs: 60_000 }).allowed).toBe(false);

    // key2 deve essere indipendente
    expect(rateLimit({ key: key2, max: 3, windowMs: 60_000 }).allowed).toBe(true);
  });

  it('retryAfterSec is reasonable', () => {
    const key = `test-retry-${Math.random()}`;
    const window = 60_000;
    for (let i = 0; i < 5; i++) {
      rateLimit({ key, max: 5, windowMs: window });
    }
    const denied = rateLimit({ key, max: 5, windowMs: window });
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSec).toBeLessThanOrEqual(60);
    expect(denied.retryAfterSec).toBeGreaterThan(0);
  });

  it('limit field reflects max param', () => {
    const result = rateLimit({ key: `test-limit-${Math.random()}`, max: 42, windowMs: 1000 });
    expect(result.limit).toBe(42);
  });
});

describe('getClientIp', () => {
  const mkReq = (headers: Record<string, string>) =>
    new Request('http://localhost', { headers });

  it('extracts from x-forwarded-for (first IP)', () => {
    const req = mkReq({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' });
    expect(getClientIp(req)).toBe('1.2.3.4');
  });

  it('extracts single x-forwarded-for', () => {
    const req = mkReq({ 'x-forwarded-for': '1.2.3.4' });
    expect(getClientIp(req)).toBe('1.2.3.4');
  });

  it('falls back to x-real-ip', () => {
    const req = mkReq({ 'x-real-ip': '9.9.9.9' });
    expect(getClientIp(req)).toBe('9.9.9.9');
  });

  it('returns "unknown" when no header', () => {
    const req = mkReq({});
    expect(getClientIp(req)).toBe('unknown');
  });

  it('trims whitespace', () => {
    const req = mkReq({ 'x-forwarded-for': '   1.2.3.4  , 5.6.7.8' });
    expect(getClientIp(req)).toBe('1.2.3.4');
  });
});
