import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FASCE_DI_DOMANI } from '@/lib/quando-arriva';

// Le altre regole della cassa (termini accettati, fascia scelta) restano soddisfatte: qui si guarda solo la verifica Stripe.
vi.mock('@/lib/auth/accettazione-testi', async (o) => ({ ...((await o()) as object), vaChiestaSenzaTrattenere: async () => 'lascia-entrare' }));

/**
 * R31-012 — CON LA CARTA ACCESA SI PAGA SOLO UN NEGOZIO CHE HA FINITO LA VERIFICA STRIPE.
 *
 * L'interruttore della carta vale per tutto il sito, la verifica del conto collegato è negozio per
 * negozio. Senza `stripe_payouts_enabled` il bonifico resta fermo (PENDING_SELLER_ONBOARDING) e i
 * soldi del cliente restano sul conto di MyCity. La rotta deve rifiutare con un messaggio chiaro e
 * non aprire nessuna sessione di pagamento. Stripe e database sono finti.
 */

const P1 = '11111111-1111-1111-1111-111111111111';
const P2 = '33333333-3333-3333-3333-333333333333';
const S1 = '22222222-2222-2222-2222-222222222222';
const S2 = '44444444-4444-4444-4444-444444444444';
const NEGOZIO = { lat: 45.0526, lng: 9.6929 };

const state: {
  products: unknown[];
  sellers: unknown[];
  profili: unknown[];
} = { products: [], sellers: [], profili: [] };

const createSession = vi.fn(async (_input: unknown) => ({ id: 'cs_test', url: 'https://stripe.test/cs_test' }));
const inserimentiPagamento = vi.fn();

vi.mock('@/lib/funzioni-al-lancio', async (originale) => ({
  ...((await originale()) as Record<string, unknown>),
  CARTA_ACCESA: true,
}));
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
      return {
        select: () => ({
          in: (_c: string, ids: string[]) =>
            Promise.resolve({ data: state.products.filter((p) => ids.includes((p as { id: string }).id)), error: null }),
        }),
      };
    }
    if (table === 'seller_public_profiles') {
      return { select: () => ({ in: () => Promise.resolve({ data: state.sellers, error: null }) }) };
    }
    return { select: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) };
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
        insert: (riga: unknown) => {
          inserimentiPagamento(riga);
          return {
            select: () => ({
              single: () =>
                Promise.resolve({
                  data: { id: 'pc_1', expires_at: new Date(Date.now() + 2 * 3600_000).toISOString() },
                  error: null,
                }),
            }),
          };
        },
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    }
    if (table === 'user_addresses') {
      return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) };
    }
    if (table === 'profiles') {
      return { select: () => ({ in: () => Promise.resolve({ data: state.profili, error: null }) }) };
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

function richiesta(gruppi: Array<{ sellerId: string; productId: string }>): never {
  return new Request('http://localhost/api/stripe/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      groups: gruppi.map((g) => ({ sellerId: g.sellerId, items: [{ productId: g.productId, quantity: 1 }], shippingCents: 0 })),
      delivery: { fullName: 'Mario Rossi', address: 'Via Roma 1', city: 'Piacenza', zip: '29121', phone: '3330000000' },
      couponDiscountCents: 0,
      pickupDiscountCents: 0,
      pickupInStore: false,
      deliverySlot: FASCE_DI_DOMANI[0],
    }),
  }) as never;
}

function negozio(id: string, nome: string, verificato: boolean | null) {
  return { id, store_name: nome, store_lat: NEGOZIO.lat, store_lng: NEGOZIO.lng, stripe_payouts_enabled: verificato };
}

describe('R31-012 — la carta si paga solo ai negozi con la verifica Stripe finita', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Un martedì mattina qualunque: nessuna regola di orario deve entrare in gioco.
    vi.useFakeTimers({ now: new Date('2026-11-17T09:30:00Z'), toFake: ['Date'] });
    state.products = [
      { id: P1, name: 'Pane', price: 10, images: ['a.jpg'], seller_id: S1, stock: 50, status: 'available' },
      { id: P2, name: 'Latte', price: 5, images: ['b.jpg'], seller_id: S2, stock: 50, status: 'available' },
    ];
    state.sellers = [negozio(S1, 'Forno di prova', true), negozio(S2, 'Latteria di prova', true)];
    state.profili = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('negozio verificato: il pagamento con la carta si apre', async () => {
    const res = await POST(richiesta([{ sellerId: S1, productId: P1 }]));
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it('negozio che non ha finito la verifica: 409 chiaro, nessuna sessione Stripe, nessun pagamento in attesa', async () => {
    state.sellers = [negozio(S1, 'Forno di prova', false)];
    const res = await POST(richiesta([{ sellerId: S1, productId: P1 }]));
    expect(res.status).toBe(409);
    const corpo = JSON.stringify(await res.json());
    expect(corpo).toContain('Forno di prova');
    expect(corpo).toMatch(/contanti/i);
    expect(createSession, 'sessione di pagamento aperta verso un negozio non verificato').not.toHaveBeenCalled();
    expect(inserimentiPagamento).not.toHaveBeenCalled();
  });

  it('carrello di due negozi, uno solo verificato: nessuna sessione', async () => {
    state.sellers = [negozio(S1, 'Forno di prova', true), negozio(S2, 'Latteria di prova', false)];
    const res = await POST(
      richiesta([
        { sellerId: S1, productId: P1 },
        { sellerId: S2, productId: P2 },
      ]),
    );
    expect(res.status).toBe(409);
    expect(JSON.stringify(await res.json())).toContain('Latteria di prova');
    expect(createSession).not.toHaveBeenCalled();
  });

  it('stato del conto sconosciuto (null) vale come non verificato', async () => {
    state.sellers = [negozio(S1, 'Forno di prova', null)];
    const res = await POST(richiesta([{ sellerId: S1, productId: P1 }]));
    expect(res.status).toBe(409);
    expect(createSession).not.toHaveBeenCalled();
  });

  it('negozio approvato senza insegna, letto dal profilo, non verificato: nessuna sessione', async () => {
    state.sellers = [];
    state.profili = [
      { id: S1, store_name: null, store_lat: NEGOZIO.lat, store_lng: NEGOZIO.lng, role: 'seller', is_approved: true, stripe_payouts_enabled: false },
    ];
    const res = await POST(richiesta([{ sellerId: S1, productId: P1 }]));
    expect(res.status).toBe(409);
    expect(createSession).not.toHaveBeenCalled();
  });

  it('negozio approvato senza insegna, letto dal profilo, verificato: il pagamento si apre', async () => {
    state.sellers = [];
    state.profili = [
      { id: S1, store_name: null, store_lat: NEGOZIO.lat, store_lng: NEGOZIO.lng, role: 'seller', is_approved: true, stripe_payouts_enabled: true },
    ];
    const res = await POST(richiesta([{ sellerId: S1, productId: P1 }]));
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    expect(createSession).toHaveBeenCalledTimes(1);
  });
});
