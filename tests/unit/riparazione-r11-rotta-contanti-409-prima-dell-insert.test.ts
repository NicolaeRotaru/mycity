import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * LA ROTTA DEI CONTANTI RIFIUTA UNA FASCIA A MENO DI UN'ORA DALLA FINE, E LO FA PRIMA DELL'INSERT.
 *
 * Le prove vecchie su questo punto leggono il sorgente e cercano parole: restano verdi anche se il
 * controllo si sposta dopo la creazione dell'ordine (il cliente avrebbe un ordine vero e una
 * risposta di errore). Qui si fa girare l'handler POST con un database finto e un orologio finto:
 *   · martedì 26 maggio 2026, 17:30 a Roma, fascia «In giornata · 15:00–18:00» (restano 30 minuti);
 *   · la risposta deve essere 409 e sull'ordine non deve essere stato chiamato nessun insert.
 * Controprova: la stessa richiesta con la fascia di domani passa e crea l'ordine (200), così la
 * prova non è verde solo perché la rotta rifiuta tutto.
 */
const inseriti: Array<Record<string, unknown>> = [];

function risolvibile(valore: unknown) {
  const b: Record<string, unknown> = {
    select: () => b, eq: () => b, in: () => b, insert: () => b, update: () => b, delete: () => b,
    limit: () => b, order: () => b,
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
vi.mock('@/lib/auth/accettazione-testi', async (o) => ({ ...((await o()) as object), vaChiestaSenzaTrattenere: async () => 'lascia-entrare' }));
vi.mock('@/lib/coupons', () => ({ validateCoupon: vi.fn(async () => ({ ok: false, reason: 'nessuno' })) }));
vi.mock('@/lib/shipping', () => ({ shippingCentsFor: vi.fn(() => 500), compensoRiderCents: vi.fn(() => 250) }));
vi.mock('@/lib/shipping-coordinate', () => ({ coordinateDaIndirizziSalvati: vi.fn(async () => null) }));
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
  contaAcquisto: vi.fn(async () => undefined),
  misuraAttiva: () => true,
  analyticsConsentita: vi.fn(async () => true),
}));

vi.mock('@/lib/supabase/server', () => {
  const prodotti = [
    { id: '11111111-1111-1111-1111-111111111111', seller_id: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Pane', price: 5, stock: 10, has_variants: false, images: [], status: 'available' },
  ];
  // Negozio aperto tutto il giorno, tutti i giorni: l'unico motivo di rifiuto è la regola dei 60 minuti.
  const sempreAperto = Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((g) => [g, [['0:00', '23:59']]]));
  const venditori = [
    { id: 'aaaaaaaa-0000-0000-0000-000000000001', store_name: 'Forno', full_name: null, store_lat: 45.05, store_lng: 9.69, store_hours: sempreAperto, email: 'a@b.it', role: 'seller', is_approved: true },
  ];
  const from = (table: string): Record<string, unknown> => {
    if (table === 'products') return risolvibile({ data: prodotti, error: null });
    if (table === 'profiles' || table === 'seller_public_profiles') return risolvibile({ data: venditori, error: null });
    if (table === 'product_variants') return risolvibile({ data: [], error: null });
    if (table === 'orders') {
      return {
        insert: (valori: Record<string, unknown>) => {
          inseriti.push(valori);
          return { select: () => ({ single: () => Promise.resolve({ data: { id: `ord-${inseriti.length}`, created_at: new Date().toISOString() }, error: null }) }) };
        },
        delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
        select: () => risolvibile({ data: [], error: null }),
      };
    }
    if (table === 'order_items') return { insert: () => Promise.resolve({ error: null }), delete: () => ({ eq: () => Promise.resolve({ error: null }) }) };
    if (table === 'cod_checkout_attempts') {
      return {
        insert: () => Promise.resolve({ error: null }),
        delete: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
        update: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }), then: (r: (x: unknown) => unknown) => r({ error: null }) }) }),
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }), maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
      };
    }
    if (table === 'notifications') return { insert: () => Promise.resolve({ error: null }) };
    return risolvibile({ data: [], error: null });
  };
  const rpc = (name: string) => Promise.resolve({ data: name === 'wallet_debit' ? 0 : null, error: null });
  return {
    getAdminSupabase: () => ({
      from, rpc,
      auth: { admin: { getUserById: async (id: string) => ({ data: { user: { id, email: `${id}@test.it` } } }) } },
    }),
    getServerSupabase: async () => ({
      auth: { getUser: async () => ({ data: { user: { id: 'cliente-1', email: 'cliente@test.it' } } }) },
      from,
    }),
  };
});

function richiesta(fascia: string): never {
  return new Request('http://localhost/api/orders/cod', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      groups: [{ sellerId: 'aaaaaaaa-0000-0000-0000-000000000001', items: [{ productId: '11111111-1111-1111-1111-111111111111', quantity: 1 }], shippingCents: 0 }],
      delivery: { fullName: 'Maria Rossi', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', phone: '3331234567' },
      pickupInStore: false,
      deliverySlot: fascia,
      useCredit: false,
    }),
  }) as never;
}

async function esegui(fascia: string) {
  const { POST } = await import('@/app/api/orders/cod/route');
  return (POST as unknown as (req: never) => Promise<Response>)(richiesta(fascia));
}

beforeEach(() => {
  inseriti.length = 0;
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'] });
  // 17:30 a Roma (CEST = UTC+2) di martedì 26 maggio 2026.
  vi.setSystemTime(new Date('2026-05-26T15:30:00Z'));
});
afterEach(() => { vi.useRealTimers(); });

describe('la rotta dei contanti: la fascia di oggi a meno di un\'ora dalla fine', () => {
  it('risponde 409 e non crea nessun ordine', async () => {
    const res = await esegui('In giornata · 15:00–18:00');
    expect(res.status).toBe(409);
    expect(inseriti, 'l\'ordine è stato inserito prima del rifiuto').toEqual([]);
  });

  it('controprova: la fascia di domani, stesso negozio e stessa ora, passa e crea l\'ordine', async () => {
    const res = await esegui('Domani · 9:00–12:00');
    expect(res.status).toBe(200);
    expect(inseriti.length).toBe(1);
  });
});
