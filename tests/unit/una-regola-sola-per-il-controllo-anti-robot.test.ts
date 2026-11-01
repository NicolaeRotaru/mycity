import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Una regola sola per il controllo anti-robot.
 *
 * Con la coppia di chiavi configurata il controllo vale sul server per tutte e
 * due le porte (iscrizione e accesso). Senza chiavi le porte restano aperte
 * alle persone e restano i limiti di frequenza — che non devono colpire sei
 * persone della stessa famiglia o dello stesso forno, sulla stessa linea.
 */

const chiavi: { segreta?: string } = {};
const signUpMock = vi.fn();
const signInMock = vi.fn();

vi.mock('@/lib/env', () => ({
  env: {
    appUrl: () => 'https://mycity.test',
    turnstileSecretKey: () => chiavi.segreta,
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/supabase/auth-server', () => ({
  authServer: {
    signUp: (...a: unknown[]) => signUpMock(...a),
    signIn: async (...a: unknown[]) => ({
      ...((await signInMock(...a)) as object),
      client: { auth: { signOut: async () => undefined } },
    }),
  },
}));

import { POST as iscrizione } from '@/app/api/auth/signup/route';
import { POST as accesso } from '@/app/api/auth/signin/route';

let ipProgressivo = 0;
function richiesta(corpo: Record<string, unknown>, ip?: string): Request {
  ipProgressivo += 1;
  return new Request('http://localhost/api/auth/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip ?? `10.77.0.${ipProgressivo}` },
    body: JSON.stringify(corpo),
  });
}

function configura(conChiavi: boolean) {
  vi.stubEnv('NODE_ENV', 'production');
  if (conChiavi) {
    chiavi.segreta = 'segreta-di-prova';
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'segreta-di-prova');
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'pubblica-di-prova');
  } else {
    chiavi.segreta = undefined;
    vi.stubEnv('TURNSTILE_SECRET_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', '');
  }
}

beforeEach(() => {
  signUpMock.mockReset();
  signInMock.mockReset();
  signUpMock.mockResolvedValue({ data: { user: { id: 'nuovo' }, session: null }, error: null });
  signInMock.mockResolvedValue({
    data: { user: { id: 'u1', email: 'a@b.it', email_confirmed_at: '2026-10-01T10:00:00Z' }, session: null },
    error: null,
  });
  // Cloudflare finto: solo il gettone «buono» passa.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_u: unknown, init?: { body?: string }) => {
      const ok = new URLSearchParams(init?.body ?? '').get('response') === 'buono';
      return new Response(JSON.stringify({ success: ok }), { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const credenziali = { password: 'una-password-lunga' };

describe('con la coppia di chiavi: il controllo vale sul server per tutte e due le porte', () => {
  it('iscrizione senza gettone valido → rifiutata, Supabase non viene chiamato', async () => {
    configura(true);
    const r = await iscrizione(richiesta({ email: 'robot1@x.it', ...credenziali, captchaToken: 'falso' }));
    expect(r.status).toBe(400);
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it('accesso senza gettone valido → rifiutato', async () => {
    configura(true);
    const r = await accesso(richiesta({ email: 'robot2@x.it', ...credenziali }));
    expect(r.status).toBe(400);
    expect(signInMock).not.toHaveBeenCalled();
  });

  it('con il gettone buono entrano tutte e due', async () => {
    configura(true);
    const a = await iscrizione(richiesta({ email: 'maria@x.it', ...credenziali, captchaToken: 'buono' }));
    const b = await accesso(richiesta({ email: 'maria@x.it', ...credenziali, captchaToken: 'buono' }));
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
  });
});

describe('senza chiavi: le porte restano aperte alle persone', () => {
  it('iscrizione senza gettone → iscritta', async () => {
    configura(false);
    const r = await iscrizione(richiesta({ email: 'luca@x.it', ...credenziali }));
    expect(r.status).toBe(201);
    expect(signUpMock).toHaveBeenCalledTimes(1);
  });

  it('accesso senza gettone → entra', async () => {
    configura(false);
    const r = await accesso(richiesta({ email: 'luca@x.it', ...credenziali }));
    expect(r.status).toBe(200);
  });
});

describe('sei clienti dalla stessa rete nella stessa ora', () => {
  it('con il controllo acceso sono iscritti tutti e sei', async () => {
    configura(true);
    const stessaLinea = '10.88.1.1';
    const esiti: number[] = [];
    for (let i = 1; i <= 6; i++) {
      const r = await iscrizione(
        richiesta({ email: `cliente${i}@forno.it`, ...credenziali, captchaToken: 'buono' }, stessaLinea),
      );
      esiti.push(r.status);
    }
    expect(esiti).toEqual([201, 201, 201, 201, 201, 201]);
  });
});

describe('la pagina di iscrizione passa dal server', () => {
  it('chiama la rotta del server e non registra direttamente dal browser', () => {
    const pagina = readFileSync('app/sign-up/page.tsx', 'utf8');
    expect(pagina).toContain("fetch('/api/auth/signup'");
    expect(pagina).not.toMatch(/auth\.signUp\(/);
  });

  it('il server mette ruolo, nome, versione dei testi e il ritorno con returnTo', async () => {
    configura(false);
    await iscrizione(
      richiesta({ email: 'anna@x.it', ...credenziali, role: 'seller', fullName: ' Anna ', returnTo: '/checkout' }),
    );
    const opzioni = signUpMock.mock.calls[0][2] as { emailRedirectTo: string; data: Record<string, unknown> };
    expect(opzioni.data).toMatchObject({ role: 'seller', full_name: 'Anna' });
    expect(opzioni.data.versione_testi_accettati).toBeTruthy();
    expect(decodeURIComponent(opzioni.emailRedirectTo)).toContain('/checkout');
  });
});
