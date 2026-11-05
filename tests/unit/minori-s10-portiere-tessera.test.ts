import { describe, it, expect, vi } from 'vitest';

/**
 * S10 (5/11/2026, scheda 2105) — quando il servizio di accesso cancella la
 * tessera (sessione bruciata), la cancellazione deve arrivare al browser anche
 * sul rimando al login: altrimenti il browser resta con la tessera vecchia.
 */

vi.mock('@supabase/ssr', () => ({
  createServerClient: (_u: string, _k: string, { cookies }: { cookies: { remove(n: string, o: Record<string, unknown>): void } }) => ({
    auth: {
      getUser: async () => {
        cookies.remove('sb-esempio-auth-token', { path: '/' });
        return { data: { user: null }, error: { status: 400, code: 'refresh_token_not_found', message: 'Invalid Refresh Token' } };
      },
    },
    from: () => ({}),
  }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://esempio.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'chiave-finta';
process.env.MIDDLEWARE_CACHE_SECRET = 'segreto-di-prova';

const { middleware } = await import('@/middleware');
const { NextRequest } = await import('next/server');

describe('la tessera cancellata arriva al browser sul rimando al login (2105)', () => {
  it('/profile con una sessione bruciata → /sign-in e il cookie di sessione svuotato', async () => {
    const req = new NextRequest(new URL('https://mycity.test/profile'));
    req.cookies.set('sb-esempio-auth-token', 'sessione-bruciata');
    const res = await middleware(req);
    expect(new URL(res.headers.get('location') ?? 'https://x/').pathname).toBe('/sign-in');
    const cookie = res.cookies.get('sb-esempio-auth-token');
    expect(cookie, 'il browser non riceve la cancellazione della tessera').toBeDefined();
    expect(cookie!.value).toBe('');
  });
});
