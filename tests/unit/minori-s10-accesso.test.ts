import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * S10 (5/11/2026, scheda 27) — quando il servizio di accesso è giù o frena,
 * al cliente non si dice che ha sbagliato la password.
 */

const signInMock = vi.fn();
vi.mock('@/lib/supabase/auth-server', () => ({
  authServer: {
    signUp: vi.fn(),
    signIn: async (...args: unknown[]) => {
      const res = await signInMock(...args);
      return { ...(res as object), client: { auth: { signOut: async () => undefined } } };
    },
  },
}));
vi.mock('@/lib/captcha', () => ({ verifyTurnstileToken: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/env', () => ({ env: { appUrl: () => 'http://localhost:3000' } }));

import { POST as signinPOST } from '@/app/api/auth/signin/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

const entra = (ip: string) =>
  signinPOST(
    new Request('http://localhost/api/auth/signin', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify({ email: 'a@b.com', password: 'giusta123', captchaToken: 't' }),
    }) as never,
  );

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimitBuckets();
});

describe('l\'errore del servizio di accesso non è «password sbagliata» (27)', () => {
  it('rete caduta (AuthRetryableFetchError, stato 0) → 503', async () => {
    signInMock.mockResolvedValueOnce({ data: null, error: { name: 'AuthRetryableFetchError', status: 0, message: 'fetch failed' } });
    const res = await entra('9.0.0.1');
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toMatch(/Email o password/);
  });
  it('servizio in errore (500) → 503', async () => {
    signInMock.mockResolvedValueOnce({ data: null, error: { status: 500, message: 'Database error' } });
    expect((await entra('9.0.0.2')).status).toBe(503);
  });
  it('troppe richieste a Supabase → 429', async () => {
    signInMock.mockResolvedValueOnce({ data: null, error: { status: 429, code: 'over_request_rate_limit', message: 'rate' } });
    expect((await entra('9.0.0.3')).status).toBe(429);
  });
  it('credenziali sbagliate restano 401', async () => {
    signInMock.mockResolvedValueOnce({ data: null, error: { status: 400, code: 'invalid_credentials', message: 'Invalid login credentials' } });
    expect((await entra('9.0.0.4')).status).toBe(401);
  });
});

describe('la pagina di accesso mostra il motivo vero (1631)', () => {
  it('credenziali: invita a controllare anche l\'email, non «Password non valida»', async () => {
    const { esitoDellaRispostaDiAccesso, messaggioDellaRottaDiAccesso } = await import('@/lib/auth/conferma-email');
    const esito = esitoDellaRispostaDiAccesso(false, { error: { code: 'UNAUTHORIZED', message: 'Email o password non corretti' } });
    expect(messaggioDellaRottaDiAccesso(esito)).toMatch(/controlla anche come hai scritto l'email/);
  });
  it('troppi tentativi: si legge il messaggio della rotta, non «Riprova»', async () => {
    const { esitoDellaRispostaDiAccesso, messaggioDellaRottaDiAccesso } = await import('@/lib/auth/conferma-email');
    const esito = esitoDellaRispostaDiAccesso(false, {
      error: { code: 'RATE_LIMITED', message: 'Troppi tentativi su questo account. Riprova tra qualche minuto.' },
    });
    expect(messaggioDellaRottaDiAccesso(esito)).toBe('Troppi tentativi su questo account. Riprova tra qualche minuto.');
  });
  it('la pagina usa quel messaggio prima della traduzione di ripiego', () => {
    const src = readFileSync('app/sign-in/page.tsx', 'utf8');
    expect(src).toMatch(/messaggioDellaRottaDiAccesso\(esito\)/);
  });
});

describe('gli errori di accesso e iscrizione restano accanto al campo (662)', () => {
  it('accesso: la password riceve l\'errore e il fuoco', () => {
    const src = readFileSync('app/sign-in/page.tsx', 'utf8');
    expect(src).toMatch(/error=\{erroreAccesso\}/);
    expect(src).toMatch(/getElementById\('signin-password'\)\?\.focus\(\)/);
  });
  it('iscrizione: la casella del consenso riceve l\'errore e il fuoco; l\'errore del server resta scritto', () => {
    const src = readFileSync('app/sign-up/page.tsx', 'utf8');
    expect(src).toMatch(/id="signup-consenso"[\s\S]{0,300}error=\{erroreConsenso\}/);
    expect(src).toMatch(/getElementById\('signup-consenso'\)\?\.focus\(\)/);
    expect(src).toMatch(/\{erroreIscrizione && \(\s*<p role="alert"/);
  });
});

describe('anti-robot non caricato: niente «prova lo stesso» (278)', () => {
  it('senza gettone il modulo non parte e la pagina propone Google e un indirizzo', () => {
    const src = readFileSync('app/sign-in/page.tsx', 'utf8');
    expect(src).not.toMatch(/Puoi provare lo stesso/);
    expect(src).toMatch(/if \(TURNSTILE_SITE_KEY && !captchaToken\) \{/);
    expect(src).toMatch(/entra con Google/);
    expect(src).toMatch(/mailto:\$\{indirizzoContatto\('info'\)\}/);
  });
});

describe('dall\'iscrizione «Accedi» tiene la strada dell\'ordine (1680)', () => {
  it('il link e il ritorno in alto portano returnTo', () => {
    const src = readFileSync('app/sign-up/page.tsx', 'utf8');
    expect(src).toMatch(/<Link href=\{accediHref\(returnTo\)\}/);
    expect(src).toMatch(/back=\{\{ href: accediHref\(returnTo\)/);
    expect(src).not.toMatch(/href="\/sign-in"/);
    expect(src).toMatch(/`\/sign-in\?returnTo=\$\{encodeURIComponent\(returnTo\)\}`/);
  });
});
