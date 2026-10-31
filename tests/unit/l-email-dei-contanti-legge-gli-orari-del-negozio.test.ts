import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ETICHETTA_ADESSO } from '@/lib/quando-arriva';

/**
 * 30/10/2026 (ondata 24) — L'EMAIL «NUOVO ORDINE» DEI CONTANTI LEGGE GLI ORARI DEL NEGOZIO.
 *
 * Lunedì alle 12:00 Pane Quotidiano (lun-sab 9-13 e 16:30-19:30) riceve un ordine per «Oggi ·
 * 13:00–16:30» e leggeva «entro le 16:30», mentre l'ultimo ritiro è alle 12:45: la rotta non passava
 * gli orari del negozio all'email. La prova passa dalla rotta vera (`POST /api/orders/cod`) col
 * modello vero dell'email; gli orari arrivano dalla tabella `profiles` finta, e solo se la lettura
 * chiede `store_hours`, come fa il database.
 */
const { ORARI_PQ } = vi.hoisted(() => {
  const giorno = [['09:00', '13:00'], ['16:30', '19:30']];
  return {
    ORARI_PQ: { mon: giorno, tue: giorno, wed: giorno, thu: [['09:00', '13:00']], fri: giorno, sat: giorno, sun: [] },
  };
});


const NEGOZIO = 'aaaaaaaa-0000-0000-0000-000000000001';
const PRODOTTO = '11111111-1111-1111-1111-111111111111';
const posta: Array<{ to: string; html: string; text?: string }> = [];

function risolvibile(valore: unknown) {
  const b: Record<string, unknown> = {
    select: () => b, eq: () => b, in: () => b, is: () => b, insert: () => b, update: () => b, delete: () => b,
    order: () => b, limit: () => b, gte: () => b, lte: () => b, lt: () => b, gt: () => b, neq: () => b, contains: () => b,
    single: () => Promise.resolve(valore),
    maybeSingle: () => Promise.resolve(valore),
    then: (res: (v: unknown) => unknown) => res(valore),
  };
  return b;
}

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit: (
    _opts: unknown,
    h: (ctx: { user: { id: string; email: string; email_confirmed_at: string }; profile: unknown; req: unknown }) => unknown,
  ) => (req: unknown) => h({
    user: { id: 'cliente-1', email: 'cliente@test.it', email_confirmed_at: '2026-01-01T00:00:00Z' },
    profile: { role: 'buyer', is_approved: true },
    req,
  }),
  assertCanPurchase: vi.fn(() => null),
}));
vi.mock('@/lib/coupons', () => ({ validateCoupon: vi.fn(async () => ({ ok: false, reason: 'nessuno' })) }));
vi.mock('@/lib/shipping', () => ({ shippingCentsFor: vi.fn(() => 300), compensoRiderCents: vi.fn(() => 300) }));
vi.mock('@/lib/shipping-coordinate', () => ({ coordinateDaIndirizziSalvati: vi.fn(async () => null) }));
vi.mock('@/lib/store-hours', async (originale) => ({
  ...(await originale<Record<string, unknown>>()),
  negozioPuoServire: vi.fn(() => true),
}));
// La veloce si vende solo con un fattorino online: qui ce n'è uno (al lancio è Nicola).
vi.mock('@/lib/ordini/consegna-veloce', async (originale) => ({
  ...(await originale<Record<string, unknown>>()),
  contaFattoriniOnline: vi.fn(async () => 1),
}));
vi.mock('@/lib/promotions', () => ({
  fetchActiveDiscounts: vi.fn(async () => new Map()),
  discountedUnitCents: vi.fn((prezzo: number) => Math.round(prezzo * 100)),
}));
vi.mock('@/lib/email/client', () => ({
  sendEmail: vi.fn(async (m: { to: string; html: string; text?: string }) => {
    posta.push({ to: m.to, html: m.html, text: m.text });
    return { ok: true, id: 'e1' };
  }),
}));
vi.mock('@/lib/stripe/client', () => ({
  computeOrderSplit: vi.fn(() => ({ applicationFeeCents: 100, sellerPayoutCents: 900 })),
}));
vi.mock('@/lib/analytics/server', () => ({
  contaAcquisto: vi.fn(async () => undefined),
  misuraAttiva: () => true,
  analyticsConsentita: vi.fn(async () => false),
}));

vi.mock('@/lib/supabase/server', () => {
  const prodotti = [{ id: PRODOTTO, seller_id: NEGOZIO, name: 'Pane', price: 15, stock: 10, has_variants: false, images: [], status: 'available' }];
  const venditori = [{ id: NEGOZIO, store_name: 'Pane Quotidiano', store_lat: 45.05, store_lng: 9.69, store_hours: ORARI_PQ as unknown }];
  const from = (table: string): Record<string, unknown> => {
    if (table === 'profiles') {
      // Come il database: gli orari tornano solo se la lettura li chiede.
      return {
        ...risolvibile({ data: venditori, error: null }),
        select: (colonne?: string) => risolvibile({
          data: !colonne || /store_hours|\*/.test(colonne) ? venditori : venditori.map(({ store_hours: _o, ...r }) => r),
          error: null,
        }),
      };
    }
    if (table === 'products') return risolvibile({ data: prodotti, error: null });
    if (table === 'seller_public_profiles') return risolvibile({ data: venditori, error: null });
    if (table === 'product_variants') return risolvibile({ data: [], error: null });
    if (table === 'orders') {
      return {
        insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'ord-1' }, error: null }) }) }),
        delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    }
    if (table === 'order_items') return { insert: () => Promise.resolve({ error: null }) };
    if (table === 'notifications') return { insert: () => Promise.resolve({ error: null }) };
    return risolvibile({ data: [], error: null });
  };
  return {
    getAdminSupabase: () => ({
      from,
      rpc: (name: string) => Promise.resolve({ data: name === 'wallet_debit' ? 0 : null, error: null }),
      auth: { admin: { getUserById: async (id: string) => ({ data: { user: { id, email: `${id}@test.it` } } }) } },
    }),
    getServerSupabase: async () => ({
      auth: { getUser: async () => ({ data: { user: { id: 'cliente-1', email: 'cliente@test.it' } } }) },
      from,
    }),
  };
});

function richiesta(deliverySlot: string): never {
  return new Request('http://localhost/api/orders/cod', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      groups: [{ sellerId: NEGOZIO, items: [{ productId: PRODOTTO, quantity: 1 }] }],
      delivery: { fullName: 'Maria Rossi', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', phone: '3331234567' },
      deliverySlot,
      pickupInStore: false,
      useCredit: false,
    }),
  }) as never;
}

async function ordina(ora: string, fascia: string) {
  vi.setSystemTime(new Date(ora));
  const { POST } = await import('@/app/api/orders/cod/route');
  const res = await (POST as unknown as (req: never) => Promise<Response>)(richiesta(fascia));
  expect(res.status, await res.clone().text()).toBe(200);
  await new Promise((r) => setTimeout(r, 60));
  const alNegozio = posta.find((m) => m.to === `${NEGOZIO}@test.it`);
  expect(alNegozio, 'l email «Nuovo ordine» al negozio non è partita').toBeTruthy();
  return alNegozio!;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  posta.length = 0;
  vi.resetModules();
});
afterEach(() => vi.useRealTimers());

describe('l email «Nuovo ordine» dei contanti dice l’ultimo ritiro, dagli orari del negozio', () => {
  it('caso 1 — lunedì 12:00, «Oggi · 13:00–16:30»: entro le 12:45, non le 16:30', async () => {
    const m = await ordina('2026-11-02T11:00:00.000Z', 'Oggi · 13:00–16:30');
    expect(m.html).toContain('entro le 12:45 di oggi');
    expect(m.html).not.toContain('entro le 16:30');
  });
  it('caso 2 — lunedì 14:00, «Oggi · 19:30–21:00»: entro le 19:15', async () => {
    const m = await ordina('2026-11-02T13:00:00.000Z', 'Oggi · 19:30–21:00');
    expect(m.html).toContain('entro le 19:15 di oggi');
  });
  it('caso 3 — lunedì 18:00, «Domani · 13:00–16:30»: entro le 12:45 di domani', async () => {
    const m = await ordina('2026-11-02T17:00:00.000Z', 'Domani · 13:00–16:30');
    expect(m.html).toContain('entro le 12:45 di domani');
  });
  it('caso 4 — lunedì 9:30, «Oggi · 9:00–11:00»: entro le 10:00', async () => {
    const m = await ordina('2026-11-02T08:30:00.000Z', 'Oggi · 9:00–11:00');
    expect(m.html).toContain('entro le 10:00 di oggi');
  });
});
