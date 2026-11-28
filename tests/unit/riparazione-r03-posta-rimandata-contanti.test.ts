import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FASCE_DI_DOMANI } from '@/lib/quando-arriva';

/**
 * R03-002 — In contanti, l'email «Nuovo ordine» rifiutata da Resend entra in coda per il negozio.
 *
 * La prova passa dalla rotta vera della cassa e dal `sendEmail` vero: Resend è finto e rifiuta
 * (quota superata). Prima l'email al negozio era persa; adesso ogni negozio ha la sua riga in
 * `email_queue`, che il giro send-emails riprova.
 */

const stato = vi.hoisted(() => ({
  coda: [] as Array<Record<string, unknown>>,
  tentati: [] as string[],
  inseriti: 0,
}));

vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: async (payload: { to: string }) => {
        stato.tentati.push(String(payload.to));
        return { data: null, error: { name: 'daily_quota_exceeded', message: 'You have reached your daily email quota' } };
      },
    };
  },
}));

function risolvibile(valore: unknown) {
  const b: Record<string, unknown> = {
    select: () => b, eq: () => b, in: () => b, insert: () => b, update: () => b, delete: () => b, limit: () => b,
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
vi.mock('@/lib/shipping', () => ({ shippingCentsFor: vi.fn(() => 500), compensoRiderCents: vi.fn(() => 250) }));
vi.mock('@/lib/shipping-coordinate', () => ({ coordinateDaIndirizziSalvati: vi.fn(async () => null) }));
vi.mock('@/lib/store-hours', () => ({
  negozioPuoServire: vi.fn(() => true),
  motivoNegozioChiuso: vi.fn((n: string) => `${n} è chiuso in questo momento.`),
}));
vi.mock('@/lib/promotions', () => ({
  fetchActiveDiscounts: vi.fn(async () => new Map()),
  discountedUnitCents: vi.fn((prezzo: number) => Math.round(prezzo * 100)),
}));
vi.mock('@/lib/email/templates', () => ({
  orderConfirmedBuyerTemplate: vi.fn(() => ({ subject: 'Ordine confermato', html: '<p>grazie</p>' })),
  newOrderSellerTemplate: vi.fn(() => ({ subject: 'Nuovo ordine', html: '<p>hai un ordine</p>' })),
}));
vi.mock('@/lib/stripe/client', () => ({ computeOrderSplit: vi.fn(() => ({ applicationFeeCents: 100, sellerPayoutCents: 900 })) }));
vi.mock('@/lib/analytics/server', () => ({
  contaAcquisto: vi.fn(async () => {}),
  misuraAttiva: () => true,
  analyticsConsentita: vi.fn(async () => true),
}));

vi.mock('@/lib/supabase/server', () => {
  const prodotti = [
    { id: '11111111-1111-1111-1111-111111111111', seller_id: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Pane', price: 5, stock: 10, has_variants: false, images: [], status: 'available' },
    { id: '22222222-2222-2222-2222-222222222222', seller_id: 'bbbbbbbb-0000-0000-0000-000000000002', name: 'Fiori', price: 8, stock: 10, has_variants: false, images: [], status: 'available' },
  ];
  const venditori = [
    { id: 'aaaaaaaa-0000-0000-0000-000000000001', store_name: 'Forno', full_name: null, store_lat: 45.05, store_lng: 9.69, store_hours: null, email: 'a@b.it', role: 'seller', is_approved: true },
    { id: 'bbbbbbbb-0000-0000-0000-000000000002', store_name: 'Fiorista', full_name: null, store_lat: 45.06, store_lng: 9.70, store_hours: null, email: 'c@d.it', role: 'seller', is_approved: true },
  ];
  const from = (table: string): Record<string, unknown> => {
    if (table === 'products') return risolvibile({ data: prodotti, error: null });
    if (table === 'profiles' || table === 'seller_public_profiles') return risolvibile({ data: venditori, error: null });
    if (table === 'product_variants') return risolvibile({ data: [], error: null });
    if (table === 'email_queue') {
      return { insert: async (riga: Record<string, unknown>) => { stato.coda.push(riga); return { error: null }; } };
    }
    if (table === 'orders') {
      return {
        insert: () => {
          stato.inseriti += 1;
          return { select: () => ({ single: () => Promise.resolve({ data: { id: `ord-${stato.inseriti}` }, error: null }) }) };
        },
        delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
        select: () => risolvibile({ data: [], error: null }),
      };
    }
    if (table === 'order_items') {
      return { insert: () => Promise.resolve({ error: null }), delete: () => ({ eq: () => Promise.resolve({ error: null }) }) };
    }
    if (table === 'notifications') return { insert: () => Promise.resolve({ error: null }) };
    return risolvibile({ data: [], error: null });
  };
  const rpc = (name: string) => Promise.resolve({ data: name === 'wallet_debit' ? 0 : null, error: null });
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
        { sellerId: 'bbbbbbbb-0000-0000-0000-000000000002', items: [{ productId: '22222222-2222-2222-2222-222222222222', quantity: 1 }], shippingCents: 0 },
      ],
      delivery: { fullName: 'Maria Rossi', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', phone: '3331234567' },
      pickupInStore: false,
      deliverySlot: FASCE_DI_DOMANI[0],
      useCredit: false,
    }),
  }) as never;
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-27T10:00:00Z'));
  stato.coda.length = 0;
  stato.tentati.length = 0;
  stato.inseriti = 0;
  vi.stubEnv('RESEND_API_KEY', 're_prova');
  vi.stubEnv('RESEND_FROM', 'MyCity <ordini@mycity.example>');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://mycity.example');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('R03-002 — contanti: «Nuovo ordine» rifiutata, la coda la rimanda', () => {
  it('ogni negozio ha la sua email in coda, con oggetto e corpo pronti', async () => {
    const { POST } = await import('@/app/api/orders/cod/route');
    const res = await (POST as unknown as (req: never) => Promise<Response>)(richiesta());
    expect(res.status).toBe(200);

    // La posta parte dopo la risposta, un negozio alla volta (prima il negozio, poi la conferma al cliente):
    // quando la seconda conferma è stata tentata, tutti e due i negozi sono già passati.
    await vi.waitFor(() => expect(stato.tentati.filter((t) => t === 'cliente@test.it')).toHaveLength(2), { timeout: 3000 });

    const perNegozio = (id: string) => stato.coda.filter((r) => r.user_id === id);
    expect(perNegozio('aaaaaaaa-0000-0000-0000-000000000001'), 'l email al forno e stata rifiutata e nessuno la rimanda').toHaveLength(1);
    expect(perNegozio('bbbbbbbb-0000-0000-0000-000000000002'), 'l email al fiorista e stata rifiutata e nessuno la rimanda').toHaveLength(1);
    const riga = perNegozio('aaaaaaaa-0000-0000-0000-000000000001')[0];
    expect(riga.template).toBe('posta_rimandata');
    expect((riga.metadata as Record<string, unknown>).subject).toBe('Nuovo ordine');
  });
});

describe('R03-002 (giro 2) — contanti: la conferma al cliente rifiutata entra in coda per il suo account', () => {
  it('una riga per ordine, con user_id del compratore', async () => {
    const { POST } = await import('@/app/api/orders/cod/route');
    const res = await (POST as unknown as (req: never) => Promise<Response>)(richiesta());
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(stato.coda.filter((r) => r.user_id === 'cliente-1')).toHaveLength(2), { timeout: 3000 });
    const riga = stato.coda.find((r) => r.user_id === 'cliente-1');
    expect(riga?.template).toBe('posta_rimandata');
    expect((riga?.metadata as Record<string, unknown>).subject).toBe('Ordine confermato');
  });
});

