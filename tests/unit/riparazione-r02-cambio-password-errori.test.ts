import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R02-009 (12/11/2026) — Se il servizio di accesso frena (429) o è giù (5xx, rete), il cambio
 * password non dice «password attuale non corretta».
 */

const stato: { errore: Record<string, unknown> | null; scritte: number } = { errore: null, scritte: 0 };

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (_opts: unknown, handler: (ctx: { user: unknown; req: Request }) => unknown) =>
    (req: Request) => handler({ user: { id: 'u-1', email: 'mario@example.com', app_metadata: { providers: ['email'] } }, req }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/supabase/anonimo', () => ({
  creaClientAnonimo: () => ({ auth: { signInWithPassword: async () => ({ data: {}, error: stato.errore }) } }),
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    auth: { admin: { updateUserById: async () => { stato.scritte += 1; return { data: {}, error: null }; } } },
  }),
}));

import { POST } from '@/app/api/account/cambia-password/route';

const cambia = () =>
  POST(new Request('http://localhost/api/account/cambia-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ passwordAttuale: 'vecchia-123', nuovaPassword: 'nuovissima-123' }),
  }) as never) as Promise<Response>;

beforeEach(() => { stato.scritte = 0; });

describe('R02-009 · il freno o il guasto del servizio di accesso non sono «password sbagliata»', () => {
  it('429 del freno → 429, non 401', async () => {
    stato.errore = { message: 'Request rate limit reached', status: 429, code: 'over_request_rate_limit' };
    const res = await cambia();
    expect(res.status).toBe(429);
    expect(JSON.stringify(await res.json())).not.toMatch(/non corretta/);
    expect(stato.scritte).toBe(0);
  });

  it('servizio giù (500 o rete) → 503, non 401', async () => {
    stato.errore = { message: 'boom', status: 500 };
    expect((await cambia()).status).toBe(503);
    stato.errore = { message: 'fetch failed', status: 0, name: 'AuthRetryableFetchError' };
    expect((await cambia()).status).toBe(503);
    expect(stato.scritte).toBe(0);
  });

  it('la password sbagliata resta «non corretta» (401)', async () => {
    stato.errore = { message: 'Invalid login credentials', status: 400, code: 'invalid_credentials' };
    const res = await cambia();
    expect(res.status).toBe(401);
    expect(JSON.stringify(await res.json())).toMatch(/non corretta/);
  });
});
