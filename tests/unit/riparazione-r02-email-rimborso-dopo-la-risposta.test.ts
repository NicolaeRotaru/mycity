import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

/**
 * R02-001 — Con la CARTA l'email dell'annullo è «Rimborso emesso»: non tiene ferma la richiesta, e se
 * non parte non resta solo nel registro.
 *
 * La mandava `refundOrder` dentro la richiesta (con `notifyBuyer: true`): il negozio che rifiuta un
 * ordine pagato con la carta, il cliente che annulla e il giro degli scaduti aspettavano l'invio, fino a
 * circa venti secondi per ordine, e un invio caduto restava nel registro. Qui `after()` di Next è finto
 * come dentro una richiesta: tiene da parte il lavoro, che si fa partire a mano «dopo la risposta».
 * (Banco di prova copiato da riparazione-r04-email-annullo-negozio.test.ts.)
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
// Il `refundOrder` finto fa quello che fa il vero: rende i soldi e, con `notifyBuyer: true`, aspetta
// lui l'email «Rimborso emesso» (lib/stripe/payout.ts, `notifyRefundBuyer`), e se cade lo scrive solo
// nel registro. Restituisce l'importo tornato davvero.
const refundOrderMock = vi.fn(async (a: { orderId: string; amountCents: number; notifyBuyer?: boolean }) => {
  if (a.notifyBuyer) {
    await Promise.resolve(invio({ to: 'maria@example.it', subject: 'Rimborso emesso', text: `Rimborso di ${a.amountCents / 100} € emesso sulla carta`, html: '' }))
      .catch(() => undefined);
  }
  return { refundId: 're_1', reversedCents: 0, pieno: true, modo: 'carta', importoCents: a.amountCents, creditoCents: 0, bonificoCents: 0 };
});
vi.mock('@/lib/stripe/payout', () => ({ refundOrder: (a: { orderId: string; amountCents: number; notifyBuyer?: boolean }) => refundOrderMock(a) }));
vi.mock('@/lib/stripe/client', () => ({ isStripeConfigured: () => true, getStripe: () => ({}) }));

/** Una catena di query qualunque che finisce sempre con lo stesso risultato. */
function catena(risultato: unknown): unknown {
  const c: unknown = new Proxy({}, {
    get(_b, k) {
      if (k === 'then') {
        return (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(risultato).then(ok, ko);
      }
      if (typeof k === 'symbol') return undefined;
      // Una riga sola: la prima della lista (il totale dell'ordine si rilegge così).
      if (k === 'maybeSingle' || k === 'single') {
        const r = risultato as { data: unknown; error: unknown };
        return () => Promise.resolve({ ...r, data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data });
      }
      return () => c;
    },
  });
  return c;
}

const CASELLE: Record<string, string> = { u1: 'maria@example.it', s1: 'forno@example.it', r1: 'rider@example.it' };
const guastoIndirizzo = { attivo: false };
const auth = {
  admin: {
    getUserById: async (id: string) => guastoIndirizzo.attivo
      ? { data: { user: null }, error: { message: 'auth non risponde' } }
      : { data: { user: { id, email: CASELLE[id] ?? `${id}@sconosciuto.example` } }, error: null },
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

const ASPETTA = Symbol('la richiesta aspetta ancora');
const fraPoco = <T,>(p: Promise<T>) => Promise.race([p, new Promise<typeof ASPETTA>((r) => setTimeout(() => r(ASPETTA), 300))]);

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
  guastoIndirizzo.attivo = false;
  process.env.NEXT_PUBLIC_APP_URL = 'https://mycity.example';
});
afterEach(() => {
  vi.useRealTimers();
});

const ORDINE_CARTA = { ...ORDINE, payment_method: 'card', payment_status: 'PAID', stripe_payment_intent: 'pi_1' };
const rimborsoEmesso = () => spedite.filter((m) => m.to === 'maria@example.it' && /Rimborso emesso/.test(String(m.subject)));
const avvisiRimborso = () => notifyAdminsMock.mock.calls.filter((c) => /Email del rimborso non partita/.test(String(c[0])));
const annulla = async () => {
  stato.candidati = [{ ...ORDINE_CARTA }];
  const { annullaERimborsa } = await import('@/lib/ordini/annulla');
  return annullaERimborsa(
    (await import('@/lib/supabase/server')).getAdminSupabase() as never,
    { ...ORDINE_CARTA } as never,
    { reason: 'Il negozio ha rifiutato l ordine', metadata: { source: 'seller_reject' } },
  );
};

describe('R02-001 · «Rimborso emesso» parte dopo la risposta', () => {
  it('il negozio rifiuta un ordine pagato con la carta: la richiesta non aspetta la posta (che qui non risponde mai)', async () => {
    await import('@/lib/ordini/annulla');
    invio = () => new Promise(() => undefined);
    const esito = await fraPoco(annulla());
    expect(esito, 'l annullo aspetta ancora l email del rimborso').not.toBe(ASPETTA);
    expect(esito).toMatchObject({ ok: true, refundId: 're_1' });
    expect(refundOrderMock).toHaveBeenCalledTimes(1);
  });

  it('dopo la risposta il cliente riceve «Rimborso emesso» una volta, con l importo tornato', async () => {
    await annulla();
    for (const lavoro of dopo) await lavoro();
    const e = rimborsoEmesso();
    expect(e).toHaveLength(1);
    expect(String(e[0].subject)).toMatch(/12,00/);
    expect(String(e[0].text)).toContain('sulla carta');
    expect(avvisiRimborso()).toEqual([]);
  });

  it('il giro degli scaduti risponde senza aspettare «Rimborso emesso», che parte dopo, una volta', async () => {
    invio = () => new Promise(() => undefined);
    stato.candidati = [{ ...ORDINE_CARTA }];
    const corpo = await fraPoco(giro());
    expect(corpo, 'il giro aspetta ancora l email del rimborso').not.toBe(ASPETTA);
    expect(corpo).toMatchObject({ ok: true, canceled: 1, refunded: 1 });
    invio = async (m) => { spedite.push(m); return { ok: true, id: 'm1' }; };
    for (const lavoro of dopo) await lavoro();
    expect(rimborsoEmesso()).toHaveLength(1);
  });

  it('un invio caduto arriva agli amministratori, una volta per ordine', async () => {
    invio = async (m) => {
      if (/Rimborso emesso/.test(String(m.subject))) return { ok: false, error: 'la posta non risponde' };
      spedite.push(m);
      return { ok: true, id: 'm1' };
    };
    await annulla();
    for (const lavoro of dopo) await lavoro();
    const a = avvisiRimborso();
    expect(a, 'l invio caduto resta solo nel registro').toHaveLength(1);
    expect(String(a[0][1])).toContain('#A1B2C3');
    expect(a[0][3]).toMatchObject({ unaVoltaPer: `email-rimborso-${ORDINE.id}` });
  });

  it('l indirizzo del cliente che non si legge per un guasto arriva agli amministratori', async () => {
    guastoIndirizzo.attivo = true;
    stato.candidati = [{ ...ORDINE_CARTA }];
    expect(await giro()).toMatchObject({ ok: true, canceled: 1, refunded: 1 });
    for (const lavoro of dopo) await lavoro();
    const a = avvisiRimborso();
    expect(a).toHaveLength(1);
    expect(String(a[0][1])).toContain('indirizzo del cliente');
    expect(a[0][3]).toMatchObject({ unaVoltaPer: `email-rimborso-${ORDINE.id}` });
  });
});
