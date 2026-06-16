import { describe, it, expect, vi } from 'vitest';

// Mock dell'analytics tracker (no-op nei test, dipende da posthog-js)
vi.mock('@/lib/analytics/events', () => ({
  trackErrorShown: vi.fn(),
}));

import { friendlyError } from '@/lib/errors';

/**
 * Unit test per friendlyError(): trasforma errori tecnici in italiano user-facing.
 *
 * Coverage:
 *  - Supabase codes (23505, PGRST116, ...)
 *  - HTTP status (401, 403, 429, 5xx)
 *  - String patterns (network, jwt, rate limit, permission)
 *  - Edge cases (null, undefined, plain string)
 */

describe('friendlyError - null/undefined', () => {
  it('returns generic fallback for null', () => {
    expect(friendlyError(null)).toMatch(/Qualcosa non ha funzionato/);
  });

  it('returns generic fallback for undefined', () => {
    expect(friendlyError(undefined)).toMatch(/Qualcosa non ha funzionato/);
  });
});

describe('friendlyError - Supabase error codes', () => {
  it('translates 23505 (duplicate key)', () => {
    const err = { code: '23505', message: 'duplicate key' };
    expect(friendlyError(err)).toMatch(/già stato usato/);
  });

  it('translates 23503 (FK constraint)', () => {
    const err = { code: '23503', message: 'fk violation' };
    expect(friendlyError(err)).toMatch(/non esiste più/);
  });

  it('translates 42501 (permission denied)', () => {
    const err = { code: '42501', message: 'denied' };
    expect(friendlyError(err)).toMatch(/permessi/);
  });

  it('translates PGRST116 (not found)', () => {
    const err = { code: 'PGRST116', message: '0 rows' };
    expect(friendlyError(err)).toMatch(/Non trovato/);
  });
});

describe('friendlyError - message pattern matching', () => {
  it('catches "duplicate key value" without code', () => {
    const err = { message: 'duplicate key value violates unique constraint' };
    expect(friendlyError(err)).toMatch(/già stato usato/);
  });

  it('catches network errors', () => {
    const err = { message: 'NetworkError when attempting to fetch' };
    expect(friendlyError(err)).toMatch(/connessione/);
  });

  it('catches rate limit', () => {
    const err = { message: 'too many requests' };
    expect(friendlyError(err)).toMatch(/Troppe richieste/);
  });

  it('catches JWT expired', () => {
    const err = { message: 'jwt expired' };
    expect(friendlyError(err)).toMatch(/sessione è scaduta/);
  });

  it('catches RLS violation', () => {
    const err = { message: 'row-level security policy violation' };
    expect(friendlyError(err)).toMatch(/permessi/);
  });
});

describe('friendlyError - HTTP status codes', () => {
  it('401 → Devi accedere', () => {
    expect(friendlyError({ status: 401 })).toMatch(/accedere/);
  });

  it('403 → Non hai i permessi', () => {
    expect(friendlyError({ status: 403 })).toMatch(/permessi/);
  });

  it('404 → Non trovato', () => {
    expect(friendlyError({ status: 404 })).toMatch(/Non trovato/);
  });

  it('429 → rate limit', () => {
    expect(friendlyError({ status: 429 })).toMatch(/Troppe richieste/);
  });

  it('500+ → server error', () => {
    expect(friendlyError({ status: 500 })).toMatch(/Problema del server/);
    expect(friendlyError({ status: 503 })).toMatch(/Problema del server/);
  });
});

describe('friendlyError - security (no leaks)', () => {
  it('strips technical column names (TABLE=x)', () => {
    const err = { message: 'Error processing TABLE=internal_secrets row=42' };
    const result = friendlyError(err);
    expect(result).not.toContain('TABLE');
    expect(result).not.toContain('internal_secrets');
  });

  it('strips parenthetical SQL details', () => {
    const err = { message: 'invalid input (column "fiscal_code" of type text)' };
    const result = friendlyError(err);
    expect(result).not.toContain('fiscal_code');
  });

  it('falls back if cleaned message looks weird', () => {
    const err = { message: '!@#$%^' };
    expect(friendlyError(err)).toMatch(/Qualcosa non ha funzionato/);
  });

  it('falls back for very long messages (likely stack trace)', () => {
    const err = { message: 'a'.repeat(200) };
    expect(friendlyError(err)).toMatch(/Qualcosa non ha funzionato/);
  });

  it('falls back for multi-line messages (stack trace)', () => {
    const err = { message: 'Errore imprevisto\n    at handler (/app/route.ts:42)' };
    expect(friendlyError(err)).toMatch(/Qualcosa non ha funzionato/);
  });

  it('preserves user-facing API messages longer than 100 chars (es. negozio chiuso)', () => {
    // Regressione: un cap a 100 char scartava questo messaggio del checkout COD
    // mostrando il generico, nascondendo all'utente il vero motivo (negozio chiuso).
    const msg =
      'Pane Quotidiano è chiuso in questo momento. Riprova durante gli orari di apertura indicati sulla pagina del negozio.';
    expect(msg.length).toBeGreaterThan(100);
    expect(friendlyError(new Error(msg))).toBe(msg);
  });
});

describe('friendlyError - string input', () => {
  it('accepts plain string as is', () => {
    expect(friendlyError('Custom error message')).toBe('Custom error message');
  });
});
