import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 27/8/2026 (R085) — QUATTRO VIAGGI IN FILA MENTRE LA PERSONA GUARDA LA
 * ROTELLINA.
 *
 * Tutte e due le casse — contanti e carta — leggevano prodotti, sconti attivi,
 * varianti e negozi uno dopo l'altro, ognuno in attesa del precedente. Ma gli
 * identificativi delle ultime tre letture arrivano dal corpo della richiesta,
 * non dal risultato della prima: non c'era niente da aspettare. Erano due-tre
 * giri di rete regalati nel momento esatto in cui qualcuno ha la carta in mano
 * — e sul checkout ogni frazione di secondo si legge nel tasso di abbandono.
 *
 * Come si misura senza cronometro: il finto database tiene il conto di quante
 * letture sono APERTE nello stesso istante. In fila il picco è 1; partendo
 * insieme è quante sono. Niente tempi, niente prove ballerine.
 */

/** Quante letture sono aperte nello stesso momento, e quante al massimo. */
const inVolo = { adesso: 0, picco: 0 };
const inseriti: Array<Record<string, unknown>> = [];

function letturaLenta<T>(valore: T): Promise<T> {
  return new Promise<T>((res) => {
    inVolo.adesso++;
    inVolo.picco = Math.max(inVolo.picco, inVolo.adesso);
    setTimeout(() => {
      inVolo.adesso--;
      res(valore);
    }, 5);
  });
}

const PRODOTTO = '11111111-1111-1111-1111-111111111111';
const VARIANTE = '33333333-3333-3333-3333-333333333333';
const NEGOZIO = 'aaaaaaaa-0000-0000-0000-000000000001';

const prodotti = [
  { id: PRODOTTO, seller_id: NEGOZIO, name: 'Pane', price: 5, stock: 10, has_variants: false, images: [], status: 'available' },
];
const venditori = [
  { id: NEGOZIO, store_name: 'Forno', store_lat: 45.05, store_lng: 9.69, store_hours: null },
];

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
vi.mock('@/lib/shipping', () => ({ shippingCentsFor: vi.fn(() => 500), compensoRiderCents: vi.fn(() => 250) }));
vi.mock('@/lib/shipping-coordinate', () => ({ coordinateDaIndirizziSalvati: vi.fn(async () => null) }));
vi.mock('@/lib/store-hours', () => ({ isStoreClosedForOrder: vi.fn(() => false) }));
// Anche gli sconti attivi sono un viaggio verso il database: conta come gli altri.
vi.mock('@/lib/promotions', () => ({
  fetchActiveDiscounts: vi.fn(() => letturaLenta(new Map())),
  discountedUnitCents: vi.fn((prezzo: number) => Math.round(prezzo * 100)),
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true, id: 'e1' })) }));
vi.mock('@/lib/email/templates', () => ({
  orderConfirmedBuyerTemplate: vi.fn(() => ({ subject: 's', html: 'h' })),
  newOrderSellerTemplate: vi.fn(() => ({ subject: 's', html: 'h' })),
}));
vi.mock('@/lib/stripe/client', () => ({
  computeOrderSplit: vi.fn(() => ({ applicationFeeCents: 100, sellerPayoutCents: 900 })),
  isStripeConfigured: () => true,
  createMultiSellerCheckoutSession: vi.fn(async () => ({ id: 'cs_1', url: 'https://stripe.test/cs_1' })),
}));
vi.mock('@/lib/analytics/server', () => ({
  contaAcquisto: vi.fn(async () => undefined),
  misuraAttiva: () => true,
  analyticsConsentita: vi.fn(async () => false),
}));

vi.mock('@/lib/supabase/server', () => {
  /** Le letture del checkout: quelle che devono partire insieme. */
  const letture = (table: string) => ({
    select: () => ({
      in: () => {
        if (table === 'products') return letturaLenta({ data: prodotti, error: null });
        if (table === 'product_variants') return letturaLenta({ data: [], error: null });
        return letturaLenta({ data: venditori, error: null });
      },
      eq: () => Promise.resolve({ data: [], error: null }),
    }),
  });

  const adminFrom = (table: string): Record<string, unknown> => {
    if (table === 'orders') {
      return {
        insert: (valori: Record<string, unknown>) => {
          inseriti.push(valori);
          return { select: () => ({ single: () => Promise.resolve({ data: { id: `ord-${inseriti.length}` }, error: null }) }) };
        },
        delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    }
    if (table === 'pending_checkouts') {
      return {
        select: () => {
          const b: Record<string, unknown> = {
            eq: () => b, gt: () => b, filter: () => b, order: () => b, limit: () => b,
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          };
          return b;
        },
        insert: () => ({
          select: () => ({
            single: () => Promise.resolve({ data: { id: 'pc_1', expires_at: new Date(Date.now() + 3600_000).toISOString() }, error: null }),
          }),
        }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    }
    if (table === 'consent_log') {
      return { update: () => ({ is: () => ({ in: () => Promise.resolve({ error: null }) }) }) };
    }
    return {
      insert: () => Promise.resolve({ error: null }),
      update: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }),
      delete: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
    };
  };

  const rpc = (name: string) => {
    if (name === 'claim_coupon') return Promise.resolve({ data: true, error: null });
    if (name === 'wallet_debit') return Promise.resolve({ data: 0, error: null });
    return Promise.resolve({ data: null, error: null });
  };

  return {
    getServerSupabase: async () => ({ from: letture, rpc }),
    getAdminSupabase: () => ({
      from: adminFrom,
      rpc,
      auth: { admin: { getUserById: async (id: string) => ({ data: { user: { id, email: `${id}@test.it` } } }) } },
    }),
  };
});

const corpo = {
  groups: [
    { sellerId: NEGOZIO, items: [{ productId: PRODOTTO, quantity: 1, variantId: VARIANTE }], shippingCents: 0 },
  ],
  delivery: { fullName: 'Maria Rossi', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', phone: '3331234567' },
  pickupInStore: false,
  useCredit: false,
};

function richiesta(url: string): never {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  }) as never;
}

beforeEach(() => {
  inVolo.adesso = 0;
  inVolo.picco = 0;
  inseriti.length = 0;
  vi.resetModules();
});

describe('le letture della cassa', () => {
  it('in contanti partono insieme, non una dopo l altra', async () => {
    const { POST } = await import('@/app/api/orders/cod/route');
    const res = await (POST as unknown as (req: never) => Promise<Response>)(
      richiesta('http://localhost/api/orders/cod'),
    );
    expect(res.status, 'l ordine non e stato creato: la prova non sta misurando il percorso vero').toBe(200);
    expect(
      inVolo.picco,
      'le letture del checkout in contanti sono ancora una in fila all altra',
    ).toBeGreaterThanOrEqual(3);
  });

  it('con la carta partono insieme, non una dopo l altra', async () => {
    const { POST } = await import('@/app/api/stripe/checkout/route');
    const res = await (POST as unknown as (req: never) => Promise<Response>)(
      richiesta('http://localhost/api/stripe/checkout'),
    );
    expect(res.status, 'la sessione di pagamento non e stata creata').toBe(200);
    expect(
      inVolo.picco,
      'le letture del checkout con carta sono ancora una in fila all altra',
    ).toBeGreaterThanOrEqual(3);
  });
});
