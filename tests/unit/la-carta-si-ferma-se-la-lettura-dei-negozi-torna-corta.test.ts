import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 28/10/2026 — ANCHE LA ROTTA DELLA CARTA SI FERMA SE NON VEDE IL NEGOZIO.
 *
 * Stessa riga della rotta dei contanti: `const sellers = venditoriLetti.data`, senza guardare
 * l'errore né quanti negozi erano tornati. Con la lista vuota il controllo «negozio chiuso» e
 * quello «fuori zona» non hanno nessuno da controllare, e la consegna perde le coordinate del
 * negozio. Al lancio la carta è spenta, ma la regola è una sola: quando si riaccende, deve già
 * fermarsi come i contanti. Qui il pagamento non deve aprirsi.
 */

const P1 = '11111111-1111-1111-1111-111111111111';
const S1 = '22222222-2222-2222-2222-222222222222';
const NEGOZIO = { lat: 45.0526, lng: 9.6929, nome: 'Forno di prova' };

const state: { products: unknown[]; sellers: { data: unknown[] | null; error: { message: string } | null } } = {
  products: [],
  sellers: { data: [], error: null },
};

const createSession = vi.fn(async (_input: unknown) => ({ id: 'cs_test', url: 'https://stripe.test/cs_test' }));

vi.mock('@/lib/api/middleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/middleware')>();
  return {
    ...actual,
    withAuthRateLimit:
      (_opts: unknown, handler: (ctx: { user: unknown; profile: unknown; req: Request }) => unknown) =>
      (req: Request) =>
        handler({
          user: { id: 'buyer-1', email: 'b@x.com', email_confirmed_at: '2020-01-01T00:00:00Z' },
          profile: { id: 'buyer-1', role: 'buyer', is_approved: true },
          req,
        }),
  };
});
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  createMultiSellerCheckoutSession: (input: unknown) => createSession(input),
}));
vi.mock('@/lib/coupons', () => ({ validateCoupon: vi.fn(async () => ({ ok: false, reason: 'no' })) }));
vi.mock('@/lib/shipping-coordinate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/shipping-coordinate')>();
  return { ...actual, coordinateDaIndirizziSalvati: vi.fn(async () => ({ lat: NEGOZIO.lat, lng: NEGOZIO.lng })) };
});
vi.mock('@/lib/geocodifica', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/geocodifica')>();
  return { ...actual, coordinateDiUnIndirizzo: vi.fn(async () => null) };
});

vi.mock('@/lib/supabase/server', () => {
  const serverFrom = vi.fn((table: string) => {
    if (table === 'products') {
      return { select: () => ({ in: () => Promise.resolve({ data: state.products, error: null }) }) };
    }
    return { select: () => ({ in: () => Promise.resolve(state.sellers) }) };
  });
  const adminFrom = vi.fn((table: string) => {
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
            single: () =>
              Promise.resolve({
                data: { id: 'pc_1', expires_at: new Date(Date.now() + 2 * 3600_000).toISOString() },
                error: null,
              }),
          }),
        }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    }
    if (table === 'user_addresses') {
      return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) };
    }
    // Il profilo, letto col client di servizio: qui il negozio non c'è (uscito, o mai stato negozio).
    if (table === 'profiles') {
      return { select: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) };
    }
    return { insert: () => Promise.resolve({ error: null }) };
  });
  const rpc = vi.fn((fn: string) => {
    if (fn === 'claim_coupon') return Promise.resolve({ data: true, error: null });
    return Promise.resolve({ data: 0, error: null });
  });
  return {
    getServerSupabase: vi.fn(() => ({ from: serverFrom, rpc })),
    getAdminSupabase: vi.fn(() => ({ from: adminFrom, rpc })),
  };
});

import { POST } from '@/app/api/stripe/checkout/route';

function richiesta(): never {
  return new Request('http://localhost/api/stripe/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      groups: [{ sellerId: S1, items: [{ productId: P1, quantity: 1 }], shippingCents: 0 }],
      delivery: { fullName: 'Mario Rossi', address: 'Via Roma 1', city: 'Piacenza', zip: '29121', phone: '3330000000' },
      couponDiscountCents: 0,
      pickupDiscountCents: 0,
      pickupInStore: false,
    }),
  }) as never;
}

describe('la carta non apre il pagamento se la lettura dei negozi torna corta', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.products = [{ id: P1, name: 'Pane', price: 10, images: ['a.jpg'], seller_id: S1, stock: 50, status: 'available' }];
    state.sellers = {
      data: [{ id: S1, store_name: NEGOZIO.nome, full_name: null, store_lat: NEGOZIO.lat, store_lng: NEGOZIO.lng }],
      error: null,
    };
  });

  it('controllo: col negozio letto per intero il pagamento si apre (il finto database funziona)', async () => {
    const res = await POST(richiesta());
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it('IL CASO — la lettura torna VUOTA, senza errore: il pagamento non si apre', async () => {
    state.sellers = { data: [], error: null };
    const res = await POST(richiesta());
    expect(createSession, 'pagamento aperto verso un negozio che nessuno ha controllato').not.toHaveBeenCalled();
    expect(res.status).toBe(409);
  });

  it('la lettura torna con un ERRORE: il pagamento non si apre', async () => {
    state.sellers = { data: null, error: { message: 'connessione chiusa' } };
    const res = await POST(richiesta());
    expect(createSession, 'pagamento aperto con la lettura dei negozi fallita').not.toHaveBeenCalled();
    expect(res.status).toBe(503);
  });
});
