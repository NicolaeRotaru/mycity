import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ETICHETTA_ADESSO } from '@/lib/quando-arriva';

/**
 * 30/10/2026 — L'EMAIL «NUOVO ORDINE» DICE AL NEGOZIO LA SCADENZA VERA, DALLA ROTTA VERA.
 *
 * Il modello dell'email sapeva già scrivere la scadenza, ma la rotta dei contanti non gli passava
 * né la fascia né la nascita dell'ordine: il negozio leggeva sempre «appena puoi». Esempio della
 * scheda: alle 21:15 un cliente ordina da Pane Quotidiano per «Domani · 9:00–12:00»; l'email deve
 * dire «entro le 12:00 di domani». Con la veloce delle 18:05: «entro le 18:15», i 10 minuti del freno.
 *
 * La prova passa dalla rotta vera (`POST /api/orders/cod`) con il modello vero dell'email e
 * `sendEmail` spiato, su un orologio finto.
 */

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
  const venditori = [{ id: NEGOZIO, store_name: 'Pane Quotidiano', store_lat: 45.05, store_lng: 9.69, store_hours: null }];
  const from = (table: string): Record<string, unknown> => {
    if (table === 'profiles') return risolvibile({ data: venditori, error: null });
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

describe('l email «Nuovo ordine» dalla rotta dei contanti dice la scadenza vera', () => {
  it('alle 21:15 per «Domani · 9:00–12:00»: entro le 12:00 di domani, non «appena puoi» né «15 minuti»', async () => {
    const m = await ordina('2026-10-30T20:15:00.000Z', 'Domani · 9:00–12:00');
    expect(m.html).toContain('entro le 12:00 di domani');
    expect(m.html).not.toContain('appena puoi');
    expect(m.html).not.toContain('15 minuti');
  });

  it('alle 18:05 con la veloce: i 10 minuti del freno, entro le 18:15', async () => {
    const m = await ordina('2026-10-30T17:05:00.000Z', ETICHETTA_ADESSO);
    expect(m.html).toContain('entro le 18:15');
    expect(m.html).not.toContain('appena puoi');
  });
});
