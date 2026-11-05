import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * S08 (5/11/2026) — scheda 176. Chi è entrato con Google ha un'email: il ramo
 * «account senza password» guardava solo l'email vuota e non scattava mai. La
 * rotta provava la password e rispondeva «Password attuale non corretta».
 */

const stato: { utente: Record<string, unknown>; accessiProvati: number; scritte: number } = {
  utente: {},
  accessiProvati: 0,
  scritte: 0,
};

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (_opts: unknown, handler: (ctx: { user: unknown; req: Request }) => unknown) =>
    (req: Request) => handler({ user: stato.utente, req }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/supabase/anonimo', () => ({
  creaClientAnonimo: () => ({
    auth: {
      signInWithPassword: async () => {
        stato.accessiProvati += 1;
        return { data: {}, error: { message: 'Invalid login credentials' } };
      },
    },
  }),
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    auth: { admin: { updateUserById: async () => { stato.scritte += 1; return { data: {}, error: null }; } } },
  }),
}));

import { POST } from '@/app/api/account/cambia-password/route';

function cambia() {
  return POST(new Request('http://localhost/api/account/cambia-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ passwordAttuale: 'qualcosa', nuovaPassword: 'nuovissima-123' }),
  }) as never);
}

beforeEach(() => {
  stato.accessiProvati = 0;
  stato.scritte = 0;
});

describe('chi accede con Google e prova a cambiare password', () => {
  it('riceve «accede senza password» (409), non «password attuale non corretta»', async () => {
    stato.utente = { id: 'u-g', email: 'anna@gmail.com', app_metadata: { provider: 'google', providers: ['google'] } };
    const res = await cambia();
    expect(res.status).toBe(409);
    const corpo = await res.json();
    expect(JSON.stringify(corpo)).toMatch(/senza password/);
    expect(stato.scritte).toBe(0);
  });

  it('senza app_metadata, le identità bastano a riconoscerlo', async () => {
    stato.utente = { id: 'u-g', email: 'anna@gmail.com', identities: [{ provider: 'google' }] };
    expect((await cambia()).status).toBe(409);
  });

  it('chi ha anche l email fra i fornitori prova la password come prima', async () => {
    stato.utente = { id: 'u-e', email: 'mario@example.com', app_metadata: { providers: ['email', 'google'] } };
    const res = await cambia();
    expect(res.status).toBe(401);
    expect(stato.accessiProvati).toBe(1);
  });
});
