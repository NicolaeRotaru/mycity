/**
 * Gestione consensi cookie (GDPR/ePrivacy).
 *
 * Categorie:
 *  - necessary: sempre attivi (sessione, sicurezza, anti-CSRF). Niente
 *    consenso necessario per legge.
 *  - functional: preferenze utente non essenziali (es. lingua, dark mode).
 *  - analytics: tracking aggregato (GA4, Plausible, Sentry performance).
 *  - marketing: tracking pubblicitario, retargeting, social pixel.
 *
 * Lo stato è salvato sia in localStorage (per UI) sia in un cookie
 * `mc_consent` di prima parte (per leggerlo lato server e applicare la
 * CSP/integrazioni). Il cookie ha durata 6 mesi (Garante linee guida).
 */

export type ConsentCategory = 'necessary' | 'functional' | 'analytics' | 'marketing';

export type ConsentState = {
  necessary: true;
  functional: boolean;
  analytics: boolean;
  marketing: boolean;
  ts: number;
  version: number;
};

export const CONSENT_VERSION = 1;
export const CONSENT_COOKIE = 'mc_consent';
export const CONSENT_STORAGE = 'mc_consent_v1';
export const CONSENT_MAX_AGE_DAYS = 180;

const DEFAULT_STATE: ConsentState = {
  necessary: true,
  functional: false,
  analytics: false,
  marketing: false,
  ts: 0,
  version: CONSENT_VERSION,
};

export function readConsent(): ConsentState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CONSENT_STORAGE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ConsentState;
    if (parsed.version !== CONSENT_VERSION) return null;
    return { ...DEFAULT_STATE, ...parsed, necessary: true };
  } catch {
    return null;
  }
}

export function writeConsent(partial: Partial<ConsentState>) {
  if (typeof window === 'undefined') return;
  const next: ConsentState = {
    ...DEFAULT_STATE,
    ...readConsent(),
    ...partial,
    necessary: true,
    ts: Date.now(),
    version: CONSENT_VERSION,
  };
  try {
    localStorage.setItem(CONSENT_STORAGE, JSON.stringify(next));
  } catch { /* storage pieno: noop */ }
  // Cookie first-party leggibile lato server
  const maxAge = CONSENT_MAX_AGE_DAYS * 24 * 60 * 60;
  const value = encodeURIComponent(
    `${next.functional ? 1 : 0}${next.analytics ? 1 : 0}${next.marketing ? 1 : 0}`,
  );
  document.cookie = `${CONSENT_COOKIE}=${value}; path=/; max-age=${maxAge}; SameSite=Lax`;
  window.dispatchEvent(new CustomEvent('mc:consent-change', { detail: next }));
}

export function acceptAll() {
  writeConsent({ functional: true, analytics: true, marketing: true });
}

export function rejectAll() {
  writeConsent({ functional: false, analytics: false, marketing: false });
}

export function hasConsent(category: ConsentCategory): boolean {
  if (category === 'necessary') return true;
  const s = readConsent();
  return !!(s && s[category]);
}

/**
 * Parser server-side del cookie (per leggerlo in Server Components).
 * Restituisce uno stato minimale (no ts, no version), abbastanza per
 * decidere se caricare un widget analytics o pubblicitario.
 */
export function parseConsentCookie(value: string | undefined): {
  functional: boolean;
  analytics: boolean;
  marketing: boolean;
} {
  if (!value) return { functional: false, analytics: false, marketing: false };
  const decoded = decodeURIComponent(value);
  return {
    functional: decoded[0] === '1',
    analytics: decoded[1] === '1',
    marketing: decoded[2] === '1',
  };
}
