import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

/**
 * R04-005 — L'email dell'annullo non tiene ferma la richiesta, e se non parte non resta solo nel registro.
 *
 * L'email al cliente partiva già dopo la risposta. Quella al negozio no: il giro degli ordini scaduti
 * (cento ordini a giro) la aspettava ordine per ordine, fino a venti secondi l'una, e se cadeva restava
 * solo nel registro. Qui `after()` di Next è finto come dentro una richiesta: tiene da parte il lavoro,
 * che si fa partire a mano «dopo la risposta».
 * (Banco di prova copiato da riparazione-r31-email-al-negozio-annullo.test.ts.)
 */

const dopo: Array<() => unknown> = [];
vi.mock('next/server', async (orig) => ({
  ...(await orig<object>()),
  after: (lavoro: () => unknown) => void dopo.push(lavoro),
}));
const notifyAdminsMock = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: (...a: unknown[]) => notifyAdminsMock(...a) }));

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
const ASPETTA = Symbol('la richiesta aspetta ancora');
const fraPoco = <T,>(p: Promise<T>) => Promise.race([p, new Promise<typeof ASPETTA>((r) => setTimeout(() => r(ASPETTA), 300))]);
const avvisiNegozio = () => notifyAdminsMock.mock.calls.filter((c) => /Email di annullo al negozio non partita/.test(String(c[0])));

// La rotta si carica prima: il tempo di caricarla non è il tempo della risposta.
let POST: (req: Request) => Promise<Response>;
beforeAll(async () => {
  POST = (await import('@/app/api/cron/expire-stale-orders/route')).POST as unknown as typeof POST;
});
const giro = () => POST(new Request('http://x', { method: 'POST' })).then((r) => r.json());

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-17T09:30:00Z'), toFake: ['Date'] });
  dopo.length = 0;
  spedite.length = 0;
  invio = async (m) => { spedite.push(m); return { ok: true, id: 'm1' }; };
  stato.candidati = [];
  stato.ordine = null;
  stato.campanelle = [];
  refundOrderMock.mockClear();
  notifyAdminsMock.mockClear();
  process.env.NEXT_PUBLIC_APP_URL = 'https://mycity.example';
});
afterEach(() => {
  vi.useRealTimers();
});

describe('R04-005 · l email di annullo al negozio parte dopo la risposta', () => {
  it('il giro degli scaduti risponde senza aspettare la posta (che qui non risponde mai)', async () => {
    invio = () => new Promise(() => undefined);
    stato.candidati = [{ ...ORDINE }];
    const corpo = await fraPoco(giro());
    expect(corpo, 'il giro aspetta ancora l email al negozio').not.toBe(ASPETTA);
    expect(corpo).toMatchObject({ ok: true, canceled: 1 });
    // Le due email (cliente e negozio) partono dopo la risposta.
    expect(dopo).toHaveLength(2);
  });

  it('un invio al negozio caduto arriva agli amministratori, una volta per ordine', async () => {
    invio = async (m) => {
      if (m.to === 'forno@example.it') return { ok: false, error: 'la posta non risponde' };
      spedite.push(m);
      return { ok: true, id: 'm1' };
    };
    stato.candidati = [{ ...ORDINE }];
    expect(await giro()).toMatchObject({ ok: true, canceled: 1, failed: 0 });
    for (const lavoro of dopo) await lavoro();
    const a = avvisiNegozio();
    expect(a, 'l invio caduto resta solo nel registro').toHaveLength(1);
    expect(String(a[0][1])).toContain('#A1B2C3');
    expect(a[0][3]).toMatchObject({ unaVoltaPer: `email-annullo-negozio-${ORDINE.id}` });
  });

  it('se l email al negozio parte, gli amministratori non sono disturbati', async () => {
    stato.candidati = [{ ...ORDINE }];
    await giro();
    for (const lavoro of dopo) await lavoro();
    expect(alNegozio()).toHaveLength(1);
    expect(avvisiNegozio()).toEqual([]);
  });
});
