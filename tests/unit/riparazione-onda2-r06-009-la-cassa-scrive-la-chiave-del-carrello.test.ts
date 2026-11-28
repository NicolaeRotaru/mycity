import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * R06-009 / R09-007 (onda 2) — LA ROTTA DEI CONTANTI SCRIVE LA CHIAVE DEL CARRELLO CON L'ORDINE.
 *
 * L'annullo (regola del negozio che rifiuta) e il freno della veloce ritrovano il carrello in contanti
 * dalla riga del tentativo; se la riga manca, ora dalla chiave scritta sull'ordine (`cod_cart_key`,
 * migrazione 999p). Qui la rotta vera (`POST /api/orders/cod`):
 *  · ogni ordine dello stesso invio porta la stessa chiave, quella della riga del tentativo (la chiave
 *    del browser, o quella fatta dalla rotta quando il browser non la manda);
 *  · prima della migrazione (PostgREST risponde PGRST204 sulla colonna) l'ordine nasce lo stesso,
 *    senza la chiave: un ordine che non nasce è peggio di un carrello da ritrovare a mano.
 * (Il banco è quello di minori-s02-coda-della-rotta-dei-contanti.)
 */

const NEGOZIO = 'aaaaaaaa-0000-0000-0000-000000000001';
const NEGOZIO2 = 'aaaaaaaa-0000-0000-0000-000000000002';
const PRODOTTO = '11111111-1111-1111-1111-111111111111';
const PRODOTTO2 = '22222222-2222-2222-2222-222222222222';
const banco = vi.hoisted(() => ({
  ordini: 0,
  inseriti: [] as Array<Record<string, unknown>>,
  rifiutati: 0,
  senzaColonna: false,
  righeCarrello: [] as Array<Record<string, unknown>>,
}));
const logger = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() }));

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

vi.mock('@/lib/auth/accettazione-testi', async (o) => ({ ...((await o()) as object), vaChiestaSenzaTrattenere: async () => 'lascia-entrare' }));
vi.mock('@/lib/logger', () => ({ logger }));
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
vi.mock('@/lib/ordini/consegna-veloce', async (originale) => ({
  ...(await originale<Record<string, unknown>>()),
  contaFattoriniOnline: vi.fn(async () => 1),
}));
vi.mock('@/lib/promotions', () => ({
  fetchActiveDiscounts: vi.fn(async () => new Map()),
  discountedUnitCents: vi.fn((prezzo: number) => Math.round(prezzo * 100)),
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true, id: 'e1' })) }));
vi.mock('@/lib/stripe/client', () => ({
  computeOrderSplit: vi.fn(() => ({ applicationFeeCents: 100, sellerPayoutCents: 900 })),
}));
vi.mock('@/lib/analytics/server', () => ({
  contaAcquisto: vi.fn(async () => undefined),
  misuraAttiva: () => true,
  analyticsConsentita: vi.fn(async () => false),
}));

vi.mock('@/lib/supabase/server', () => {
  const prodotti = [
    { id: PRODOTTO, seller_id: NEGOZIO, name: 'Pane', price: 15, stock: 100, has_variants: false, images: [], status: 'available' },
    { id: PRODOTTO2, seller_id: NEGOZIO2, name: 'Mele', price: 12, stock: 10, has_variants: false, images: [], status: 'available' },
  ];
  const venditori = [
    { id: NEGOZIO, store_name: 'Pane Quotidiano', store_lat: 45.05, store_lng: 9.69, store_hours: null },
    { id: NEGOZIO2, store_name: 'Frutta Bella', store_lat: 45.05, store_lng: 9.69, store_hours: null },
  ];
  const from = (table: string): Record<string, unknown> => {
    if (table === 'profiles') return risolvibile({ data: venditori, error: null });
    if (table === 'products') return risolvibile({ data: prodotti, error: null });
    if (table === 'seller_public_profiles') return risolvibile({ data: venditori, error: null });
    if (table === 'product_variants') return risolvibile({ data: [], error: null });
    if (table === 'orders') {
      return {
        insert: (riga: Record<string, unknown>) => ({
          select: () => ({
            single: () => {
              // Prima della migrazione 999p: PostgREST ferma la scrittura che nomina la colonna.
              if (banco.senzaColonna && 'cod_cart_key' in riga) {
                banco.rifiutati++;
                return Promise.resolve({
                  data: null,
                  error: { code: 'PGRST204', details: null, hint: null, message: "Could not find the 'cod_cart_key' column of 'orders' in the schema cache" },
                });
              }
              banco.inseriti.push(riga);
              return Promise.resolve({ data: { id: `ord-${++banco.ordini}`, created_at: null }, error: null });
            },
          }),
        }),
        delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    }
    if (table === 'order_items') return { insert: () => Promise.resolve({ error: null }) };
    if (table === 'notifications') return { insert: () => Promise.resolve({ error: null }) };
    if (table === 'cod_checkout_attempts') {
      const r = risolvibile({ data: [], count: 1, error: null });
      r.insert = (riga: Record<string, unknown>) => { banco.righeCarrello.push(riga); return r; };
      return r;
    }
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

function richiesta(chiave?: string): never {
  return new Request('http://localhost/api/orders/cod', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(chiave ? { 'idempotency-key': chiave } : {}) },
    body: JSON.stringify({
      groups: [
        { sellerId: NEGOZIO, items: [{ productId: PRODOTTO, quantity: 1 }] },
        { sellerId: NEGOZIO2, items: [{ productId: PRODOTTO2, quantity: 1 }] },
      ],
      delivery: { fullName: 'Maria Rossi', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', phone: '3331234567' },
      deliverySlot: 'Domani · 9:00–12:00',
      pickupInStore: false,
      useCredit: false,
    }),
  }) as never;
}

async function ordina(chiave?: string) {
  vi.setSystemTime(new Date('2026-10-30T20:15:00.000Z'));
  const { POST } = await import('@/app/api/orders/cod/route');
  const res = await (POST as unknown as (req: never) => Promise<Response>)(richiesta(chiave));
  expect(res.status, await res.clone().text()).toBe(200);
  await new Promise((r) => setTimeout(r, 120));
  return res;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  banco.ordini = 0;
  banco.inseriti = [];
  banco.rifiutati = 0;
  banco.senzaColonna = false;
  banco.righeCarrello = [];
  logger.warn.mockClear();
  vi.resetModules();
});
afterEach(() => vi.useRealTimers());

describe('la rotta dei contanti scrive la chiave del carrello con ogni ordine', () => {
  it('con la chiave del browser: i due ordini portano quella chiave, la stessa della riga del tentativo', async () => {
    await ordina('chiave-del-browser-1');
    expect(banco.inseriti).toHaveLength(2);
    expect(banco.inseriti.map((r) => r.cod_cart_key), 'l ordine nasce senza niente che lo leghi al suo carrello').toEqual([
      'chiave-del-browser-1', 'chiave-del-browser-1',
    ]);
  });

  it('senza la chiave del browser: la chiave fatta dalla rotta, la stessa della riga del carrello', async () => {
    await ordina();
    const chiavi = banco.inseriti.map((r) => r.cod_cart_key);
    expect(chiavi).toHaveLength(2);
    expect(chiavi[0]).toMatch(/^cod-/);
    expect(chiavi[1]).toBe(chiavi[0]);
    expect((banco.righeCarrello[0] as { chiave: string }).chiave).toBe(chiavi[0]);
  });

  it('prima della migrazione 999p l ordine nasce lo stesso, senza la chiave', async () => {
    banco.senzaColonna = true;
    await ordina('chiave-del-browser-2');
    expect(banco.rifiutati).toBe(2);
    expect(banco.inseriti).toHaveLength(2);
    expect(banco.inseriti.every((r) => !('cod_cart_key' in r))).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('migrazione 999p non ancora applicata'),
      expect.objectContaining({ dove: 'orders.insert (cod)' }),
    );
  });
});
