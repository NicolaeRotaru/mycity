import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PICKUP_DISCOUNT_PERCENT } from '@/lib/constants';

/**
 * /api/stripe/checkout — test di SICUREZZA anti-tampering (la difesa che protegge
 * il denaro). Il client puo' inviare importi (sconto coupon, sconto ritiro,
 * spedizione) ma il server DEVE ignorarli e ricalcolare tutto dalla fonte
 * autorevole (DB + validateCoupon + shippingCentsFor). Senza questo, un client
 * potrebbe pagare ~0 per qualunque ordine.
 *
 * Auth/rate-limit, Stripe, Supabase, coupons e shipping sono mockati (le funzioni
 * sono testate altrove). Cattura l'input passato a createMultiSellerCheckoutSession
 * e verifica che rifletta i valori SERVER, non quelli del client.
 */

const P1 = '11111111-1111-1111-1111-111111111111';
const S1 = '22222222-2222-2222-2222-222222222222';

// Stato configurabile per-test (pattern di tests/unit/api-returns.test.ts).
const state: {
  user: { id: string; email: string | null; email_confirmed_at: string | null };
  stripeConfigured: boolean;
  products: unknown[];
  sellers: unknown[];
  coupon: unknown;
  shipping: number;
} = {
  user: { id: 'buyer-1', email: 'b@x.com', email_confirmed_at: '2020-01-01T00:00:00Z' },
  stripeConfigured: true,
  products: [],
  sellers: [],
  coupon: { ok: false, reason: 'no' },
  shipping: 0,
};

// Cattura l'input dell'ultima Checkout Session creata.
const createSession = vi.fn(async (_input: unknown) => ({ id: 'cs_test', url: 'https://stripe.test/cs_test' }));

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (_opts: unknown, handler: (ctx: { user: typeof state.user; req: Request }) => unknown) =>
    (req: Request) =>
      handler({ user: state.user, req }),
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => state.stripeConfigured,
  createMultiSellerCheckoutSession: (input: unknown) => createSession(input),
}));

vi.mock('@/lib/coupons', () => ({
  validateCoupon: vi.fn(async () => state.coupon),
}));

vi.mock('@/lib/shipping', () => ({
  shippingCentsFor: vi.fn(() => state.shipping),
}));

vi.mock('@/lib/supabase/server', () => {
  const serverFrom = vi.fn((table: string) => {
    if (table === 'products') {
      return { select: () => ({ in: () => Promise.resolve({ data: state.products, error: null }) }) };
    }
    // profiles (sellers)
    return { select: () => ({ in: () => Promise.resolve({ data: state.sellers, error: null }) }) };
  });
  const adminFrom = vi.fn((table: string) => {
    if (table === 'pending_checkouts') {
      return {
        insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'pc_1' }, error: null }) }) }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    }
    return { insert: () => Promise.resolve({ error: null }) };
  });
  const rpc = vi.fn(() => Promise.resolve({ data: 0, error: null }));
  return {
    getServerSupabase: vi.fn(() => ({ from: serverFrom, rpc })),
    getAdminSupabase: vi.fn(() => ({ from: adminFrom, rpc })),
  };
});

import { POST } from '@/app/api/stripe/checkout/route';

function makeReq(body: unknown): never {
  return new Request('http://localhost/api/stripe/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never;
}

// Corpo valido con importi client GONFIATI di proposito: devono essere ignorati.
function tamperedBody(overrides: Record<string, unknown> = {}) {
  return {
    groups: [{ sellerId: S1, items: [{ productId: P1, quantity: 2 }], shippingCents: 99999 }],
    delivery: { fullName: 'X', address: 'Via 1', city: 'PC', zip: '29121', phone: '3330000000', lat: 45.1, lng: 9.1 },
    couponDiscountCents: 999999,
    pickupDiscountCents: 999999,
    pickupInStore: false,
    ...overrides,
  };
}

function lastSessionInput() {
  return createSession.mock.calls[createSession.mock.calls.length - 1][0] as {
    totalDiscountCents: number;
    shippingPerGroupCents: number[];
    groups: Array<{ items: Array<{ unitAmountCents: number; quantity: number }> }>;
  };
}

describe('POST /api/stripe/checkout — anti-tampering importi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.user = { id: 'buyer-1', email: 'b@x.com', email_confirmed_at: '2020-01-01T00:00:00Z' };
    state.stripeConfigured = true;
    state.products = [
      { id: P1, name: 'Prodotto A', price: 10, images: ['a.jpg'], seller_id: S1, stock: 50, status: 'available' },
    ];
    state.sellers = [{ id: S1, store_name: 'Negozio A', full_name: null, store_lat: 45, store_lng: 9 }];
    state.coupon = { ok: false, reason: 'no' };
    state.shipping = 500; // 5 € per gruppo, dal calcolo server (mock)
  });

  it('ignora gli importi del client: prezzo unitario dal DB, spedizione dal server, sconto 0', async () => {
    const res = await POST(makeReq(tamperedBody()));
    expect(res.status).toBe(200);
    const input = lastSessionInput();
    // prezzo unitario = price DB (10 €) * 100 = 1000, NON un valore dal client
    expect(input.groups[0].items[0].unitAmountCents).toBe(1000);
    expect(input.groups[0].items[0].quantity).toBe(2);
    // spedizione = valore server (mock 500), NON i 99999 del client
    expect(input.shippingPerGroupCents).toEqual([500]);
    // nessun coupon e niente ritiro => sconto 0, NON i 999999 del client
    expect(input.totalDiscountCents).toBe(0);
  });

  it('sconto ritiro ricalcolato server-side (ignora pickupDiscountCents del client)', async () => {
    state.shipping = 0;
    const res = await POST(makeReq(tamperedBody({ pickupInStore: true })));
    expect(res.status).toBe(200);
    const subtotalCents = 1000 * 2;
    const expectedPickup = Math.round(subtotalCents * (PICKUP_DISCOUNT_PERCENT / 100));
    expect(lastSessionInput().totalDiscountCents).toBe(expectedPickup);
    expect(expectedPickup).toBeLessThan(999999); // prova che non e' il valore client
  });

  it('sconto coupon preso da validateCoupon, non dal client', async () => {
    state.coupon = { ok: true, coupon: { code: 'BIG' }, discount: 5, freeShipping: false }; // 5 €
    const res = await POST(makeReq(tamperedBody({ couponCode: 'BIG' })));
    expect(res.status).toBe(200);
    expect(lastSessionInput().totalDiscountCents).toBe(500); // 5 € validati, non 999999
  });

  it('clamp difensivo: sconto coupon enorme non supera (subtotale + spedizione - 1c)', async () => {
    state.coupon = { ok: true, coupon: { code: 'HUGE' }, discount: 9999, freeShipping: false };
    const res = await POST(makeReq(tamperedBody({ couponCode: 'HUGE' })));
    expect(res.status).toBe(200);
    const subtotalCents = 2000;
    const shippingCents = 500;
    expect(lastSessionInput().totalDiscountCents).toBe(subtotalCents + shippingCents - 1);
  });

  it('400 se il prodotto non appartiene al venditore indicato', async () => {
    state.products = [{ id: P1, name: 'A', price: 10, images: [], seller_id: 'altro-seller', stock: 50, status: 'available' }];
    const res = await POST(makeReq(tamperedBody()));
    expect(res.status).toBe(400);
    expect(createSession).not.toHaveBeenCalled();
  });

  it('400 se il prodotto non e disponibile', async () => {
    state.products = [{ id: P1, name: 'A', price: 10, images: [], seller_id: S1, stock: 50, status: 'sold_out' }];
    const res = await POST(makeReq(tamperedBody()));
    expect(res.status).toBe(400);
  });

  it('409 se lo stock e insufficiente', async () => {
    state.products = [{ id: P1, name: 'A', price: 10, images: [], seller_id: S1, stock: 1, status: 'available' }];
    const res = await POST(makeReq(tamperedBody({ groups: [{ sellerId: S1, items: [{ productId: P1, quantity: 2 }], shippingCents: 0 }] })));
    expect(res.status).toBe(409);
    expect(createSession).not.toHaveBeenCalled();
  });

  it('400 se il coupon e invalido', async () => {
    state.coupon = { ok: false, reason: 'Codice scaduto' };
    const res = await POST(makeReq(tamperedBody({ couponCode: 'SCADUTO' })));
    expect(res.status).toBe(400);
  });

  it('403 se la email non e confermata', async () => {
    state.user = { id: 'buyer-1', email: 'b@x.com', email_confirmed_at: null };
    const res = await POST(makeReq(tamperedBody()));
    expect(res.status).toBe(403);
  });

  it('503 se Stripe non e configurato', async () => {
    state.stripeConfigured = false;
    const res = await POST(makeReq(tamperedBody()));
    expect(res.status).toBe(503);
  });
});
