import { describe, it, expect, vi } from 'vitest';
import { perchePasswordNonCambiabile } from '@/lib/account/cambio-password';

/**
 * R02-010 (12/11/2026) — «Cambiare» la password con la stessa di prima non è un cambio: la pagina
 * e la rotta lo dicono (400) e non si riscrive niente.
 */

const stato = { scritte: 0 };

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
    auth: { admin: { updateUserById: async () => { stato.scritte += 1; return { data: {}, error: null }; } } },
  }),
}));

import { POST } from '@/app/api/account/cambia-password/route';

describe('R02-010 · la nuova password uguale all attuale', () => {
  it('la rotta risponde 400 e non riscrive la password', async () => {
    const res = (await POST(new Request('http://localhost/api/account/cambia-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ passwordAttuale: 'stessa-password-1', nuovaPassword: 'stessa-password-1' }),
    }) as never)) as Response;
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/diversa/);
    expect(stato.scritte).toBe(0);
  });

  it('la pagina non la manda nemmeno', () => {
    expect(perchePasswordNonCambiabile({ currentPassword: 'stessa-password-1', newPassword: 'stessa-password-1', confirmPassword: 'stessa-password-1' }))
      .toMatch(/diversa/);
    expect(perchePasswordNonCambiabile({ currentPassword: 'vecchia-123', newPassword: 'nuovissima-123', confirmPassword: 'nuovissima-123' }))
      .toBeNull();
  });
});
