import { describe, it, expect, vi } from 'vitest';

/**
 * S10 (5/11/2026, scheda 2117) — se la lettura del profilo si rompe, il
 * portiere non manda il negoziante alla home (da dove il cookie del ruolo lo
 * rimanderebbe al pannello, in tondo): resta fuori con una pagina «riprova».
 */

const stato = vi.hoisted(() => ({ profilo: 'rotto' as 'rotto' | 'seller' }));

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'forno-1', email_confirmed_at: '2026-09-01T10:00:00Z' } }, error: null }) },
    from: () => {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order', 'limit']) q[m] = () => q;
      q.single = async () =>
        stato.profilo === 'rotto'
          ? { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }
          : { data: { role: 'seller', is_approved: true }, error: null };
      q.maybeSingle = async () => ({ data: { versione_testo: 'privacy-9.9+terms-9.9' }, error: null });
      q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok);
      return q;
    },
  }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://esempio.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'chiave-finta';
process.env.MIDDLEWARE_CACHE_SECRET = 'segreto-di-prova';

const { middleware } = await import('@/middleware');
const { NextRequest } = await import('next/server');

describe('profilo non letto sul pannello del negozio (2117)', () => {
  it('nessun rimando alla home: 503 con «riprova»', async () => {
    stato.profilo = 'rotto';
    const req = new NextRequest(new URL('https://mycity.test/seller/products'));
    req.cookies.set('sb-esempio-auth-token', 'sessione-del-forno');
    const res = await middleware(req);
    expect(res.headers.get('location')).toBeNull();
    expect(res.status).toBe(503);
  });
});
