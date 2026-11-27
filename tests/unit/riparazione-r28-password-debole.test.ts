/**
 * 26/11/2026 (R28-005) — LA PASSWORD DEBOLE O RUBATA SI DICE IN ITALIANO,
 * IN REGISTRAZIONE E NEL CAMBIO PASSWORD DEL PROFILO.
 *
 * Supabase rifiuta la password con un `AuthWeakPasswordError` (codice
 * `weak_password`, motivi `pwned` / `length` / `characters`). La rotta del cambio
 * password ne faceva un 500 «Non è stato possibile aggiornare la password», la
 * rotta di registrazione un «Controlla i dati e riprova». Qui gli errori sono
 * quelli veri di @supabase/auth-js, e c'è anche il testo che nessuno conosce col
 * codice `weak_password`: deve uscire in italiano, senza link che non ci sono.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthApiError, AuthWeakPasswordError } from '@supabase/supabase-js';

const stato = vi.hoisted(() => ({
  errCambio: null as unknown,
  errSignup: null as unknown,
}));

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (_opts: unknown, handler: (ctx: { user: unknown; req: Request }) => unknown) =>
    (req: Request) =>
      handler({ user: { id: 'u-28', email: 'anna@esempio.it', app_metadata: { providers: ['email'] } }, req }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/supabase/anonimo', () => ({
  creaClientAnonimo: () => ({ auth: { signInWithPassword: async () => ({ data: {}, error: null }) } }),
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    auth: { admin: { updateUserById: async () => ({ data: { user: null }, error: stato.errCambio }) } },
  }),
}));
vi.mock('@/lib/supabase/auth-server', () => ({
  authServer: { signUp: async () => ({ data: { user: null, session: null }, error: stato.errSignup }) },
}));
vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: async () => ({ allowed: true, retryAfterSec: 0 }),
  getClientIp: () => '10.0.0.5',
}));
vi.mock('@/lib/captcha', () => ({ verifyTurnstileToken: async () => ({ ok: true }) }));
vi.mock('@/lib/env', () => ({ env: { appUrl: () => 'https://mycity.test' } }));

import { POST as cambiaPassword } from '@/app/api/account/cambia-password/route';
import { POST as registrati } from '@/app/api/auth/signup/route';
import { PASSWORD_RUBATA, PASSWORD_SEMPLICE } from '@/lib/auth/errori-nuova-password';
import { friendlyError } from '@/lib/errors';

const PWNED = 'Password is known to be weak and easy to guess, please choose a different one.';
const CORTA = 'Password should be at least 12 characters.';
const SEMPLICE =
  'Password should contain at least one character of each: abcdefghijklmnopqrstuvwxyz, ABCDEFGHIJKLMNOPQRSTUVWXYZ, 0123456789';
const SCONOSCIUTO = 'Password rejected by the new policy XYZ';

async function cambia(): Promise<{ status: number; messaggio: string }> {
  const res = (await cambiaPassword(
    new Request('https://mycity.test/api/account/cambia-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ passwordAttuale: 'vecchia-password-1', nuovaPassword: 'Password123!' }),
    }) as never,
  )) as Response;
  const corpo = (await res.json()) as { error?: { message?: string } };
  return { status: res.status, messaggio: corpo.error?.message ?? '' };
}

async function iscrivi(): Promise<{ status: number; messaggio: string }> {
  const res = await registrati(
    new Request('https://mycity.test/api/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'anna@esempio.it', password: 'Password123!', captchaToken: 'g', role: 'buyer' }),
    }),
  );
  const corpo = (await res.json()) as { error?: { message?: string } };
  return { status: res.status, messaggio: corpo.error?.message ?? '' };
}

beforeEach(() => {
  stato.errCambio = null;
  stato.errSignup = null;
});

describe('R28-005 · cambio password del profilo', () => {
  it('IL CASO CHE ROMPEVA — password negli elenchi rubati: 400 con la frase italiana, non 500', async () => {
    stato.errCambio = new AuthWeakPasswordError(PWNED, 422, ['pwned']);
    expect(await cambia()).toEqual({ status: 400, messaggio: PASSWORD_RUBATA });
  });

  it('troppo corta: dice il minimo che chiede Supabase', async () => {
    stato.errCambio = new AuthWeakPasswordError(CORTA, 422, ['length']);
    expect(await cambia()).toEqual({ status: 400, messaggio: 'La password è troppo corta: usane una di almeno 12 caratteri.' });
  });

  it('troppo semplice: il consiglio su maiuscole, numeri, simboli', async () => {
    stato.errCambio = new AuthWeakPasswordError(SEMPLICE, 422, ['characters']);
    expect(await cambia()).toEqual({ status: 400, messaggio: PASSWORD_SEMPLICE });
  });

  it('codice weak_password con un testo sconosciuto: italiano, e nessun «link» che qui non c’è', async () => {
    stato.errCambio = new AuthWeakPasswordError(SCONOSCIUTO, 422, []);
    const r = await cambia();
    expect(r).toEqual({ status: 400, messaggio: PASSWORD_SEMPLICE });
    expect(r.messaggio).not.toMatch(/link|policy|rejected/i);
  });

  it('un guasto vero resta il 500 di prima', async () => {
    stato.errCambio = new AuthApiError('Database error updating user', 500, 'unexpected_failure');
    expect(await cambia()).toEqual({ status: 500, messaggio: 'Non è stato possibile aggiornare la password' });
  });
});

describe('R28-005 · rotta di registrazione', () => {
  it('IL CASO CHE ROMPEVA — password rubata: la frase della password, non «controlla i dati»', async () => {
    stato.errSignup = new AuthWeakPasswordError(PWNED, 422, ['pwned']);
    expect(await iscrivi()).toEqual({ status: 400, messaggio: PASSWORD_RUBATA });
  });

  it('codice weak_password con un testo sconosciuto: italiano, senza link inesistente', async () => {
    stato.errSignup = new AuthWeakPasswordError(SCONOSCIUTO, 422, []);
    const r = await iscrivi();
    expect(r).toEqual({ status: 400, messaggio: PASSWORD_SEMPLICE });
    expect(r.messaggio).not.toMatch(/link|policy|rejected/i);
  });

  it('email già usata e limite delle email restano come prima', async () => {
    stato.errSignup = new AuthApiError('User already registered', 422, 'user_already_exists');
    expect(await iscrivi()).toEqual({ status: 400, messaggio: 'Registrazione non riuscita. Controlla i dati e riprova.' });
    stato.errSignup = new AuthApiError('email rate limit exceeded', 429, 'over_email_send_rate_limit');
    expect(await iscrivi()).toEqual({ status: 400, messaggio: 'Registrazione non riuscita. Controlla i dati e riprova.' });
  });
});

describe('R28-005 · pagina /sign-up (già a posto alla base, con friendlyError)', () => {
  it('l’errore che Supabase dà al browser esce in italiano, anche col testo sconosciuto, senza link', () => {
    expect(friendlyError(new AuthWeakPasswordError(PWNED, 422, ['pwned']))).toBe(PASSWORD_RUBATA);
    const sconosciuto = friendlyError(new AuthWeakPasswordError(SCONOSCIUTO, 422, []));
    expect(sconosciuto).toBe(PASSWORD_SEMPLICE);
    expect(sconosciuto).not.toMatch(/link/i);
  });
});
