/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { CONSENT_MAX_AGE_DAYS, CONSENT_STORAGE, CONSENT_VERSION, hasConsent, readConsent } from '@/lib/consent';

/** S08 (5/11/2026) — scheda 86: un sì ai cookie più vecchio di 180 giorni non vale più. */

const salva = (giorniFa: number) =>
  localStorage.setItem(
    CONSENT_STORAGE,
    JSON.stringify({ necessary: true, functional: false, analytics: true, marketing: false, ts: Date.now() - giorniFa * 86_400_000, version: CONSENT_VERSION }),
  );

beforeEach(() => localStorage.clear());

describe('la scadenza del consenso', () => {
  it('un sì di 200 giorni fa non accende più le statistiche', () => {
    salva(200);
    expect(readConsent()).toBeNull();
    expect(hasConsent('analytics')).toBe(false);
  });
  it('un sì di ieri vale', () => {
    salva(1);
    expect(hasConsent('analytics')).toBe(true);
  });
  it('il confine è CONSENT_MAX_AGE_DAYS', () => {
    salva(CONSENT_MAX_AGE_DAYS - 1);
    expect(readConsent()).not.toBeNull();
    salva(CONSENT_MAX_AGE_DAYS + 1);
    expect(readConsent()).toBeNull();
  });
});
