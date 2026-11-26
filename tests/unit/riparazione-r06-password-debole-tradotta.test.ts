import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * R06-003 (26/11/2026) — Il rifiuto di una password debole o rubata: nel cambio password
 * non è più un 500 generico, in registrazione non esce più come «controlla i dati».
 */

const stato: { errCambio: Record<string, unknown> | null; errSignup: Record<string, unknown> | null } = {
  errCambio: null,
  errSignup: null,
};

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (_opts: unknown, handler: (ctx: { user: unknown; req: Request }) => unknown) =>
    (req: Request) => handler({ user: { id: 'u-1', email: 'mario@example.com', app_metadata: { providers: ['email'] } }, req }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/supabase/anonimo', () => ({
  creaClientAnonimo: () => ({ auth: { signInWithPassword: async () => ({ data: {}, error: null }) } }),
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    auth: { admin: { updateUserById: async () => ({ data: {}, error: stato.errCambio }) } },
  }),
}));
vi.mock('@/lib/supabase/auth-server', () => ({
  authServer: { signUp: async () => ({ data: null, error: stato.errSignup }) },
}));
vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: async () => ({ allowed: true, retryAfterSec: 0 }),
  getClientIp: () => '1.2.3.4',
}));
vi.mock('@/lib/captcha', () => ({ verifyTurnstileToken: async () => ({ ok: true }) }));
vi.mock('@/lib/env', () => ({ env: { appUrl: () => 'http://localhost' } }));

import { POST as cambiaPassword } from '@/app/api/account/cambia-password/route';
import { POST as signup } from '@/app/api/auth/signup/route';
import { PASSWORD_RUBATA, PASSWORD_SEMPLICE } from '@/lib/auth/errori-nuova-password';

const cambia = () =>
  cambiaPassword(new Request('http://localhost/api/account/cambia-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ passwordAttuale: 'vecchia-123', nuovaPassword: 'nuovissima-123' }),
  }) as never) as Promise<Response>;

const iscrivi = () =>
  signup(new Request('http://localhost/api/auth/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'nuova@example.com', password: 'password-lunga-1' }),
  })) as Promise<Response>;

beforeEach(() => { stato.errCambio = null; stato.errSignup = null; });

describe('R06-003 · cambio password', () => {
  it('password rubata → 400 col testo italiano, non 500', async () => {
    stato.errCambio = { message: 'Password is known to be weak and easy to guess', code: 'weak_password', reasons: ['pwned'] };
    const res = await cambia();
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('rubate');
    expect(PASSWORD_RUBATA).toContain('rubate');
  });

  it('password semplice → 400 col consiglio sulle maiuscole', async () => {
    stato.errCambio = { message: 'Password should contain at least one character of each', code: 'weak_password', reasons: ['characters'] };
    const res = await cambia();
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain(PASSWORD_SEMPLICE);
  });

  it('un guasto vero resta 500', async () => {
    stato.errCambio = { message: 'database exploded', status: 500 };
    expect((await cambia()).status).toBe(500);
  });
});

describe('R06-003 · registrazione', () => {
  it('password rubata → il messaggio italiano della password, non «controlla i dati»', async () => {
    stato.errSignup = { message: 'Password is known to be weak and easy to guess', code: 'weak_password', reasons: ['pwned'] };
    const res = await iscrivi();
    expect(res.status).toBe(400);
    const testo = JSON.stringify(await res.json());
    expect(testo).toContain('rubate');
    expect(testo).not.toMatch(/Controlla i dati/);
  });

  it('un altro rifiuto resta il messaggio generico', async () => {
    stato.errSignup = { message: 'something else', code: 'validation_failed' };
    const res = await iscrivi();
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/Controlla i dati/);
  });
});

describe('R06-003 · pagina di registrazione', () => {
  it('traduce la password rifiutata con l\'aiutante condiviso', () => {
    const src = readFileSync(join(process.cwd(), 'app', 'sign-up', 'page.tsx'), 'utf8');
    expect(src).toMatch(/traduciErroreNuovaPassword\(/);
  });
});
