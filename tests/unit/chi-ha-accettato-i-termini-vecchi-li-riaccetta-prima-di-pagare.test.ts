import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 31/10/2026 (ondata 6) — CHI HA ACCETTATO I TERMINI VECCHI LI RIACCETTA.
 *
 * Fatto legale.termini-riaccettazione (Nicola, 31/10): quando i Termini
 * cambiano, chi è già iscritto li riaccetta prima di ordinare.
 *
 * Maria si è iscritta il 1/9 coi Termini 2.0: nel verbale (`consent_log`) c'è
 * la riga «privacy-2.0+terms-2.0» e nel profilo la data. I Termini ora sono i
 * 3.0. Prima di questa correzione:
 *  - arrivava al pagamento senza che nessuno le chiedesse niente;
 *  - se cliccava «accetto», la rotta rispondeva «già accettato» e non
 *    scriveva la riga con la versione nuova.
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
const { POST } = await import('@/app/api/account/accetta-condizioni/route');
const { VERSIONE_TESTI_LEGALI } = await import('@/lib/legal/versione');

function aperturaDelPagamento() {
  const req = new NextRequest(new URL('https://mycity.test/checkout'));
  req.cookies.set('sb-esempio-auth-token', 'sessione-di-maria');
  return req;
}

function doveLaManda(res: Response): string | null {
  const dove = res.headers.get('location');
  if (!dove) return null;
  const u = new URL(dove);
  return `${u.pathname}?next=${u.searchParams.get('next')}`;
}

beforeEach(() => {
  rigaVerbale = RIGA_2_0;
  verbaleRotto = false;
  inseriti.length = 0;
});

describe('Maria ha accettato i Termini 2.0, ora sono in vigore i 3.0', () => {
  it('i testi in vigore sono i Termini 3.0', () => {
    expect(VERSIONE_TESTI_LEGALI).toMatch(/terms-3\.0$/);
  });

  it('aprendo il pagamento viene mandata a riaccettare i Termini, e poi torna al pagamento', async () => {
    const res = await middleware(aperturaDelPagamento());
    expect(doveLaManda(res), 'chi ha accettato i 2.0 paga sotto i 3.0 senza averli visti').toBe(
      '/accetta-condizioni?next=/checkout',
    );
  });

  it('cliccando «accetto», il verbale registra la versione in vigore invece di rispondere «già accettato»', async () => {
    const res = await POST(new Request('https://mycity.test/api/account/accetta-condizioni', {
      method: 'POST',
      headers: { 'user-agent': 'prova' },
    }) as never);
    const corpo = await res.json();
    const verbale = inseriti.find((i) => i.tabella === 'consent_log');
    expect(corpo.gia, 'la rotta dice «già accettato» a chi ha accettato i testi vecchi').toBeUndefined();
    expect(verbale?.riga.versione_testo).toBe(VERSIONE_TESTI_LEGALI);
  });

  it('dopo averli riaccettati paga senza altre domande, e un secondo «accetto» non scrive una riga doppia', async () => {
    rigaVerbale = { versione_testo: VERSIONE_TESTI_LEGALI };
    const res = await middleware(aperturaDelPagamento());
    expect(doveLaManda(res)).not.toBe('/accetta-condizioni?next=/checkout');

    const r2 = await POST(new Request('https://mycity.test/api/account/accetta-condizioni', { method: 'POST' }) as never);
    expect((await r2.json()).gia).toBe(true);
    expect(inseriti).toHaveLength(0);
  });

  // 1/11/2026 — «Nessuna riga» non vale piu' come «in regola» (vedi
  // la-riaccettazione-guarda-la-versione-a-verbale-non-la-data.test.ts): resta
  // vero che un verbale che non si lascia leggere non blocca il pagamento.
  it('se il verbale non si lascia leggere il pagamento non diventa un giro senza fine', async () => {
    verbaleRotto = true;
    const res = await middleware(aperturaDelPagamento());
    expect(doveLaManda(res)).not.toBe('/accetta-condizioni?next=/checkout');
  });
});
