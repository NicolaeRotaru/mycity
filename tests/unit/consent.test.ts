import { describe, it, expect } from 'vitest';
import {
  parseConsentCookie,
  CONSENT_VERSION,
  CONSENT_COOKIE,
  CONSENT_STORAGE,
  CONSENT_MAX_AGE_DAYS,
} from '@/lib/consent';

/**
 * Unit test per lib/consent (parte pure — parseConsentCookie + costanti).
 *
 * Le funzioni con side-effects DOM (readConsent/writeConsent) sono E2E test.
 */

describe('Consent constants', () => {
  it('cookie name is "mc_consent"', () => {
    expect(CONSENT_COOKIE).toBe('mc_consent');
  });

  it('storage key versioned', () => {
    expect(CONSENT_STORAGE).toMatch(/^mc_consent_v\d+$/);
  });

  it('cookie max age = 180 days (Garante guidelines)', () => {
    expect(CONSENT_MAX_AGE_DAYS).toBe(180);
  });

  it('CONSENT_VERSION is positive integer', () => {
    expect(CONSENT_VERSION).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(CONSENT_VERSION)).toBe(true);
  });
});

describe('parseConsentCookie', () => {
  it('returns all false for empty/undefined input', () => {
    const result = parseConsentCookie(undefined);
    expect(result).toEqual({ functional: false, analytics: false, marketing: false });
  });

  it('returns all false for empty string', () => {
    expect(parseConsentCookie('')).toEqual({ functional: false, analytics: false, marketing: false });
  });

  it('parses "111" as all accepted', () => {
    expect(parseConsentCookie('111')).toEqual({ functional: true, analytics: true, marketing: true });
  });

  it('parses "000" as all rejected', () => {
    expect(parseConsentCookie('000')).toEqual({ functional: false, analytics: false, marketing: false });
  });

  it('parses "100" as only functional', () => {
    expect(parseConsentCookie('100')).toEqual({ functional: true, analytics: false, marketing: false });
  });

  it('parses "010" as only analytics', () => {
    expect(parseConsentCookie('010')).toEqual({ functional: false, analytics: true, marketing: false });
  });

  it('parses "001" as only marketing', () => {
    expect(parseConsentCookie('001')).toEqual({ functional: false, analytics: false, marketing: true });
  });

  it('decodes URI-encoded values', () => {
    expect(parseConsentCookie(encodeURIComponent('111'))).toEqual({
      functional: true, analytics: true, marketing: true,
    });
  });
});
