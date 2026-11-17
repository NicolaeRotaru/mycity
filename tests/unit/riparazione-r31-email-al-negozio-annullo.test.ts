import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * R31-023 — Quando un ordine viene annullato il negozio non riceveva nessuna email.
 *
 * Il negozio sa dell'ordine nuovo per email («Nuovo ordine»), ma dell'annullo solo dalla campanella,
 * che si vede riaprendo il sito. Qui le tre strade che annullano senza che sia il negozio a farlo: il
 * giro che chiude gli ordini mai accettati, il cliente, l'amministrazione. Dopo l'annullo riuscito parte
 * l'email al negozio (alla sua casella), e se la posta cade l'annullo resta fatto. Nessuna email vera:
 * l'invio è finto, come Supabase e Stripe.
 */

let invio: (m: Record<string, unknown>) => Promise<unknown>;
const spedite: Array<Record<string, unknown>> = [];

vi.mock('@/lib/email/client', () => ({
  sendEmail: (m: Record<string, unknown>) => invio(m),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => undefined) }));
vi.mock('@/lib/api/middleware', () => ({
  withCronAuth: (h: (req: unknown) => unknown) => (req: unknown) => h(req),
  withAuthRateLimit:
    (_o: unknown, h: (ctx: { req: unknown; user: unknown; params: unknown }) => unknown) =>
    (req: unknown, ctx: { params: Record<string, string> }) =>
      h({ req, user: { id: 'u1' }, params: ctx.params }),
  withAdminAuth:
    (h: (ctx: { req: unknown; user: unknown; params: unknown }) => unknown) =>
    (req: unknown, ctx: { params: Record<string, string> }) =>
      h({ req, user: { id: 'admin1' }, params: ctx.params }),
}));
const refundOrderMock = vi.fn(async (_a: unknown) => ({ refundId: 're_1', reversedCents: 0 }));
vi.mock('@/lib/stripe/payout', () => ({ refundOrder: (a: unknown) => refundOrderMock(a) }));
vi.mock('@/lib/stripe/client', () => ({ isStripeConfigured: () => true, getStripe: () => ({}) }));

/** Una catena di query qualunque che finisce sempre con lo stesso risultato. */
function catena(risultato: unknown): unknown {
  const c: unknown = new Proxy({}, {
    get(_b, k) {
      if (k === 'then') {
        return (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(risultato).then(ok, ko);
      }
      if (typeof k === 'symbol') return undefined;
      return () => c;
    },
  });
  return c;
}

const CASELLE: Record<string, string> = { u1: 'maria@example.it', s1: 'forno@example.it', r1: 'rider@example.it' };
const auth = {
  admin: {
    getUserById: async (id: string) => ({ data: { user: { id, email: CASELLE[id] ?? `${id}@sconosciuto.example` } }, error: null }),
  },
};

const ORDINE = {
  id: 'a1b2c3d4-0000-4000-8000-000000000001',
  user_id: 'u1',
  seller_id: 's1',
  rider_id: null,
  total_price: 12,
  payment_method: 'cod',
  payment_status: 'PENDING',
  delivery_status: 'NEW',
  wallet_applied_cents: 0,
  cash_confirmed_at: null,
  coupon_code: null,
  stripe_payment_intent: null,
  created_at: '2026-11-16T08:00:00Z',
};

const stato = { candidati: [] as Array<Record<string, unknown>>, ordine: null as Record<string, unknown> | null, campanelle: [] as unknown[] };
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (t: string) => {
      if (t === 'orders') {
        return {
          select: () => catena({ data: stato.ordine ?? stato.candidati, error: null }),
          update: () => catena({ data: [{ id: ORDINE.id }], error: null }),
        };
      }
      if (t === 'notifications') {
        return { insert: async (r: unknown) => { stato.campanelle.push(r); return { error: null }; } };
      }
      return { select: () => catena({ data: [], error: null }), insert: async () => ({ error: null }) };
    },
    rpc: async () => ({ data: null, error: null }),
    auth,
  }),
}));

const alNegozio = () => spedite.filter((m) => m.to === 'forno@example.it');

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-17T09:30:00Z'), toFake: ['Date'] });
  spedite.length = 0;
  invio = async (m) => { spedite.push(m); return { ok: true, id: 'm1' }; };
  stato.candidati = [];
  stato.ordine = null;
  stato.campanelle = [];
  refundOrderMock.mockClear();
  process.env.NEXT_PUBLIC_APP_URL = 'https://mycity.example';
});
afterEach(() => {
  vi.useRealTimers();
});

describe('R31-023 — il giro che chiude gli ordini mai accettati', () => {
  async function giro() {
    const { POST } = await import('@/app/api/cron/expire-stale-orders/route');
    const res = await (POST as unknown as (req: Request) => Promise<Response>)(new Request('http://x', { method: 'POST' }));
    return res.json();
  }

  it('IL CASO DELLA VOCE — il negozio riceve l’email dell’annullo, oltre alla campanella', async () => {
    stato.candidati = [{ ...ORDINE }];
    const corpo = await giro();
    expect(corpo).toMatchObject({ ok: true, canceled: 1 });
    expect(alNegozio(), 'il negozio non sa per email che l’ordine è annullato').toHaveLength(1);
    expect(String(alNegozio()[0].subject)).toContain('#A1B2C3');
    expect(String(alNegozio()[0].subject)).toMatch(/annullato/i);
    expect(String(alNegozio()[0].text)).toMatch(/non è stato accettato in tempo/);
    expect(alNegozio()[0].tipo).toBe('transazionale');
    // La cliente riceve la sua, come prima.
    expect(spedite.filter((m) => m.to === 'maria@example.it')).toHaveLength(1);
  });

  it('se la posta al negozio cade, l’ordine resta annullato lo stesso', async () => {
    invio = async (m) => {
      if (m.to === 'forno@example.it') throw new Error('resend giu');
      spedite.push(m);
      return { ok: true, id: 'm1' };
    };
    stato.candidati = [{ ...ORDINE }];
    const corpo = await giro();
    expect(corpo).toMatchObject({ ok: true, canceled: 1, failed: 0 });
  });
});

describe('R31-023 — il cliente annulla', () => {
  async function annulla() {
    const { POST } = await import('@/app/api/orders/[id]/cancel/route');
    return (POST as unknown as (req: Request, ctx: { params: Record<string, string> }) => Promise<Response>)(
      new Request('http://x', { method: 'POST' }),
      { params: { id: ORDINE.id } },
    );
  }

  it('dopo l’annullo riuscito il negozio riceve l’email', async () => {
    stato.ordine = { ...ORDINE };
    const res = await annulla();
    expect(res.status).toBe(200);
    expect(alNegozio(), 'il negozio non sa per email che il cliente ha annullato').toHaveLength(1);
    expect(String(alNegozio()[0].text)).toMatch(/cliente ha annullato/i);
  });

  it('un ordine già accettato non si annulla, e al negozio non parte niente', async () => {
    stato.ordine = { ...ORDINE, delivery_status: 'ACCEPTED' };
    const res = await annulla();
    expect(res.status).toBe(409);
    expect(alNegozio()).toHaveLength(0);
  });
});

describe('R31-023 — l’amministrazione annulla', () => {
  it('dopo l’annullo riuscito il negozio riceve l’email', async () => {
    stato.ordine = { ...ORDINE };
    const { POST } = await import('@/app/api/admin/orders/[id]/cancel/route');
    const res = await (POST as unknown as (req: Request, ctx: { params: Record<string, string> }) => Promise<Response>)(
      new Request('http://x', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }),
      { params: { id: ORDINE.id } },
    );
    expect(res.status).toBe(200);
    expect(alNegozio(), 'il negozio non sa per email che l’amministrazione ha annullato').toHaveLength(1);
    expect(String(alNegozio()[0].text)).toMatch(/amministrazione ha annullato/i);
  });
});
