import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * S10 (5/11/2026) — il portiere (middleware.ts) sulla cassa.
 */

const RIGA_2_0 = { versione_testo: 'privacy-2.0+terms-2.0' };
let rigaVerbale: { versione_testo: string } | null = RIGA_2_0;
let verbaleRotto = false;
const inseriti: Array<{ tabella: string; riga: Record<string, unknown> }> = [];

function catena(tabella: string) {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'limit', 'update']) q[m] = () => q;
  q.single = async () => ({ data: { role: 'buyer', is_approved: true }, error: null });
  q.maybeSingle = async () => ({
    data: tabella === 'consent_log' ? rigaVerbale : { tos_accepted_at: '2026-09-01T10:00:00Z' },
    error: tabella === 'consent_log' && verbaleRotto ? { message: 'verbale illeggibile' } : null,
  });
  q.insert = (riga: Record<string, unknown>) => {
    inseriti.push({ tabella, riga });
    return Promise.resolve({ error: null });
  };
  q.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
    Promise.resolve({ data: null, error: null }).then(ok, ko);
  return q;
}

const MARIA = { id: 'maria', email_confirmed_at: '2026-09-01T10:00:00Z' };

// Il client della persona, quello che usa il middleware.
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: MARIA }, error: null }) },
    from: (t: string) => catena(t),
  }),
}));
// I client della rotta di accettazione.
vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({ auth: { getUser: async () => ({ data: { user: MARIA }, error: null }) } }),
  getAdminSupabase: () => ({ from: (t: string) => catena(t) }),
}));
vi.mock('@/lib/rate-limit', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/lib/rate-limit')),
  getClientIp: () => '127.0.0.1',
  rateLimitAsync: async () => ({ allowed: true }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://esempio.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'chiave-finta';
process.env.MIDDLEWARE_CACHE_SECRET = 'segreto-di-prova';

const { middleware } = await import('@/middleware');
const { NextRequest } = await import('next/server');

beforeEach(() => {
  rigaVerbale = RIGA_2_0;
  verbaleRotto = false;
  inseriti.length = 0;
});

describe('dopo i Termini si torna alla cassa coi suoi parametri (2589)', () => {
  it('/checkout?passo=2&registrazione=email → next con tutto l\'indirizzo', async () => {
    const req = new NextRequest(new URL('https://mycity.test/checkout?passo=2&registrazione=email'));
    req.cookies.set('sb-esempio-auth-token', 'sessione-di-maria');
    const res = await middleware(req);
    const dove = new URL(res.headers.get('location') ?? 'https://x/');
    expect(dove.pathname).toBe('/accetta-condizioni');
    expect(dove.searchParams.get('next')).toBe('/checkout?passo=2&registrazione=email');
  });
});

describe('sulla cassa il cookie del ruolo non fa saltare la domanda sui Termini (2585)', () => {
  it('con un mc_ruolo valido, chi ha i Termini 2.0 viene mandata a riaccettarli', async () => {
    // Primo giro su una pagina del catalogo: il portiere legge il profilo e
    // mette da parte il ruolo nel cookie firmato.
    const prima = new NextRequest(new URL('https://mycity.test/'));
    prima.cookies.set('sb-esempio-auth-token', 'sessione-di-maria');
    const r1 = await middleware(prima);
    const ruolo = r1.cookies.get('mc_ruolo')?.value;
    expect(ruolo, 'il primo giro deve scrivere il cookie del ruolo').toBeTruthy();

    const cassa = new NextRequest(new URL('https://mycity.test/checkout'));
    cassa.cookies.set('sb-esempio-auth-token', 'sessione-di-maria');
    cassa.cookies.set('mc_ruolo', ruolo!);
    const r2 = await middleware(cassa);
    expect(new URL(r2.headers.get('location') ?? 'https://x/').pathname).toBe('/accetta-condizioni');
  });
});
