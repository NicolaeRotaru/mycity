import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FASCE_DI_DOMANI } from '@/lib/quando-arriva';

/**
 * R26-020 — Se l'addebito del credito risponde con un errore, la cassa in
 * contanti lo considerava mai avvenuto.
 *
 * Un timeout puo' arrivare DOPO che `wallet_debit` ha gia' scalato il saldo e
 * scritto la riga `order_cod` nel diario. La rotta scriveva un avviso e andava
 * avanti a credito zero: l'ordine nasceva col totale pieno, il cliente pagava
 * tutto al fattorino e il credito tolto non tornava piu'.
 *
 * Adesso la rotta rilegge il diario con lo stesso riferimento: se la riga c'e',
 * quel credito e' speso e si scala dal totale; se la rilettura cade, si ferma.
 *
 * ⚪ Non tocca il database: Supabase e' finto.
 */

const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
const inseriti: Array<Record<string, unknown>> = [];
const filtriDiario: Array<[string, unknown]> = [];

/** Cosa risponde la rilettura del diario del credito. */
let esitoDiario: { data: unknown; error: { message: string } | null } = { data: null, error: null };

function risolvibile(valore: unknown) {
  const b: Record<string, unknown> = {
    select: () => b,
    eq: () => b,
    in: () => b,
    insert: () => b,
    update: () => b,
    delete: () => b,
    limit: () => b,
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
vi.mock('@/lib/shipping', () => ({
  shippingCentsFor: vi.fn(() => 500),
  compensoRiderCents: vi.fn(() => 250),
}));
vi.mock('@/lib/shipping-coordinate', () => ({
  coordinateDaIndirizziSalvati: vi.fn(async () => null),
}));
vi.mock('@/lib/store-hours', () => ({
  negozioPuoServire: vi.fn(() => true),
  motivoNegozioChiuso: vi.fn((n: string) => `${n} è chiuso in questo momento.`),
}));
vi.mock('@/lib/promotions', () => ({
  fetchActiveDiscounts: vi.fn(async () => new Map()),
  discountedUnitCents: vi.fn((prezzo: number) => Math.round(prezzo * 100)),
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true, id: 'e1' })) }));
vi.mock('@/lib/email/templates', () => ({
  orderConfirmedBuyerTemplate: vi.fn(() => ({ subject: 's', html: 'h' })),
  newOrderSellerTemplate: vi.fn(() => ({ subject: 's', html: 'h' })),
}));
vi.mock('@/lib/stripe/client', () => ({
  computeOrderSplit: vi.fn(() => ({ applicationFeeCents: 100, sellerPayoutCents: 900 })),
}));
vi.mock('@/lib/analytics/server', () => ({
  contaAcquisto: vi.fn(async () => {}),
  misuraAttiva: () => true,
  analyticsConsentita: vi.fn(async () => true),
}));

vi.mock('@/lib/supabase/server', () => {
  const prodotti = [
    { id: '11111111-1111-1111-1111-111111111111', seller_id: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Pane', price: 30, stock: 10, has_variants: false, images: [], status: 'available' },
  ];
  const venditori = [
    { id: 'aaaaaaaa-0000-0000-0000-000000000001', store_name: 'Forno', full_name: null, store_lat: 45.05, store_lng: 9.69, store_hours: null, email: 'a@b.it', role: 'seller', is_approved: true },
  ];

  const from = (table: string): Record<string, unknown> => {
    if (table === 'products') return risolvibile({ data: prodotti, error: null });
    if (table === 'profiles') return risolvibile({ data: venditori, error: null });
    if (table === 'seller_public_profiles') return risolvibile({ data: venditori, error: null });
    if (table === 'product_variants') return risolvibile({ data: [], error: null });
    if (table === 'wallet_ledger') {
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (c: string, v: unknown) => { filtriDiario.push([c, v]); return q; },
        maybeSingle: () => Promise.resolve(esitoDiario),
      };
      return q;
    }
    if (table === 'orders') {
      return {
        insert: (valori: Record<string, unknown>) => {
          inseriti.push(valori);
          return {
            select: () => ({
              single: () => Promise.resolve({ data: { id: `ord-${inseriti.length}` }, error: null }),
            }),
          };
        },
        delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
        select: () => risolvibile({ data: [], error: null }),
      };
    }
    if (table === 'order_items') {
      return {
        insert: () => Promise.resolve({ error: null }),
        delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    }
    if (table === 'notifications') return { insert: () => Promise.resolve({ error: null }) };
    return risolvibile({ data: [], error: null });
  };

  const rpc = (name: string, args: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    // Il credito e' stato tolto davvero, ma la risposta e' arrivata come errore.
    if (name === 'wallet_debit') return Promise.resolve({ data: null, error: { message: 'timeout' } });
    return Promise.resolve({ data: null, error: null });
  };

  return {
    getAdminSupabase: () => ({
      from,
      rpc,
      auth: { admin: { getUserById: async (id: string) => ({ data: { user: { id, email: `${id}@test.it` } } }) } },
    }),
    getServerSupabase: async () => ({
      auth: { getUser: async () => ({ data: { user: { id: 'cliente-1', email: 'cliente@test.it' } } }) },
      from,
    }),
  };
});

function richiesta(): never {
  return new Request('http://localhost/api/orders/cod', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      groups: [
        { sellerId: 'aaaaaaaa-0000-0000-0000-000000000001', items: [{ productId: '11111111-1111-1111-1111-111111111111', quantity: 1 }], shippingCents: 0 },
      ],
      delivery: {
        fullName: 'Maria Rossi', address: 'Via Verdi 10', city: 'Piacenza',
        zip: '29121', phone: '3331234567',
      },
      pickupInStore: false,
      deliverySlot: FASCE_DI_DOMANI[0],
      useCredit: true,
    }),
  }) as never;
}

async function esegui() {
  const { POST } = await import('@/app/api/orders/cod/route');
  return (POST as unknown as (req: never) => Promise<Response>)(richiesta());
}

beforeEach(() => {
  rpcCalls.length = 0;
  inseriti.length = 0;
  filtriDiario.length = 0;
  esitoDiario = { data: null, error: null };
  vi.resetModules();
});

describe('R26-020 — il credito tolto con una risposta di errore non si perde', () => {
  it('se il diario ha la riga della spesa, l ordine porta quel credito e il fattorino incassa il resto', async () => {
    esitoDiario = { data: { delta_cents: -2000 }, error: null };
    const res = await esegui();
    expect(res.status).toBe(200);
    expect(inseriti.length).toBe(1);
    const ordine = inseriti[0];
    expect(ordine.wallet_applied_cents, 'il credito tolto non arriva sull ordine').toBe(2000);
    expect(Math.round(Number(ordine.total_price) * 100)).toBe(Number(ordine.gross_total_cents) - 2000);

    // La rilettura usa lo STESSO riferimento della spesa, del cliente, motivo order_cod.
    const debito = rpcCalls.find((c) => c.name === 'wallet_debit');
    expect(filtriDiario).toContainEqual(['ref', debito?.args.p_ref]);
    expect(filtriDiario).toContainEqual(['reason', 'order_cod']);
    expect(filtriDiario).toContainEqual(['user_id', 'cliente-1']);
  });

  it('se il diario non ha la riga, l ordine nasce a credito zero', async () => {
    esitoDiario = { data: null, error: null };
    const res = await esegui();
    expect(res.status).toBe(200);
    expect(inseriti.length).toBe(1);
    expect(inseriti[0].wallet_applied_cents).toBe(0);
    expect(Math.round(Number(inseriti[0].total_price) * 100)).toBe(Number(inseriti[0].gross_total_cents));
  });

  it('se nemmeno il diario si legge, non nasce un ordine a credito zero: ci si ferma e la merce torna', async () => {
    esitoDiario = { data: null, error: { message: 'rete giu' } };
    const res = await esegui();
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(inseriti.length, 'nato un ordine senza sapere se il credito e stato tolto').toBe(0);
    expect(rpcCalls.some((c) => c.name === 'restore_stock')).toBe(true);
  });
});
