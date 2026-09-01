import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 27/8/2026 (R086) — LA POSTA DELL'ORDINE IN CONTANTI PARTIVA UNA ALLA VOLTA.
 *
 * Per ogni negozio del carrello la rotta faceva, in fila: una lettura
 * dell'utente venditore, un'email al negozio, UNA LETTURA DEL PROFILO DI QUEL
 * NEGOZIO (sempre la stessa tabella, un viaggio per ordine) e un'email al
 * cliente. Con quattro negozi sono otto viaggi verso il database e otto invii
 * uno dietro l'altro, tenuti in vita dopo la risposta.
 *
 * Il cliente non aspetta — la posta parte dopo la risposta — ma più lungo è
 * quel lavoro, più è probabile che qualcuno paghi alla consegna e non riceva
 * mai la conferma, senza che nel registro risulti niente.
 *
 * Adesso i nomi dei negozi si leggono in una volta sola e i giri partono
 * insieme.
 */

const NEGOZI = [
  'aaaaaaaa-0000-0000-0000-000000000001',
  'bbbbbbbb-0000-0000-0000-000000000002',
  'cccccccc-0000-0000-0000-000000000003',
];
const PRODOTTI = [
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333',
];

/** Quante volte si e' letta la tabella dei profili, e con quale filtro. */
const lettureProfili: Array<'per-uno' | 'tutti-insieme'> = [];
const postaInviata: Array<{ to: string }> = [];
const inseriti: Array<Record<string, unknown>> = [];
/** Quante letture dell'utente venditore sono aperte insieme. */
const utentiInVolo = { adesso: 0, picco: 0 };

function risolvibile(valore: unknown) {
  const b: Record<string, unknown> = {
    select: () => b,
    eq: () => b,
    in: () => b,
    is: () => b,
    insert: () => b,
    update: () => b,
    delete: () => b,
    order: () => b,
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
vi.mock('@/lib/shipping', () => ({ shippingCentsFor: vi.fn(() => 500), compensoRiderCents: vi.fn(() => 250) }));
vi.mock('@/lib/shipping-coordinate', () => ({ coordinateDaIndirizziSalvati: vi.fn(async () => null) }));
vi.mock('@/lib/store-hours', () => ({ isStoreClosedForOrder: vi.fn(() => false) }));
vi.mock('@/lib/promotions', () => ({
  fetchActiveDiscounts: vi.fn(async () => new Map()),
  discountedUnitCents: vi.fn((prezzo: number) => Math.round(prezzo * 100)),
}));
vi.mock('@/lib/email/client', () => ({
  sendEmail: vi.fn(async (m: { to: string }) => {
    postaInviata.push({ to: m.to });
    return { ok: true, id: 'e1' };
  }),
}));
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
  analyticsConsentita: vi.fn(async () => false),
}));

vi.mock('@/lib/supabase/server', () => {
  const prodotti = PRODOTTI.map((id, i) => ({
    id, seller_id: NEGOZI[i], name: `Roba ${i}`, price: 5, stock: 10, has_variants: false, images: [], status: 'available',
  }));
  const venditori = NEGOZI.map((id, i) => ({
    id, store_name: `Negozio ${i}`, store_lat: 45.05, store_lng: 9.69, store_hours: null,
  }));

  const tabellaProfili = () => ({
    select: () => ({
      // La lettura vecchia: una per ordine.
      eq: () => ({
        single: () => {
          lettureProfili.push('per-uno');
          return Promise.resolve({ data: venditori[0], error: null });
        },
      }),
      // Quella nuova: tutti i negozi del carrello in un colpo solo.
      in: () => {
        lettureProfili.push('tutti-insieme');
        return Promise.resolve({ data: venditori, error: null });
      },
    }),
  });

  const from = (table: string): Record<string, unknown> => {
    if (table === 'profiles') return tabellaProfili() as unknown as Record<string, unknown>;
    if (table === 'products') return risolvibile({ data: prodotti, error: null });
    if (table === 'seller_public_profiles') return risolvibile({ data: venditori, error: null });
    if (table === 'product_variants') return risolvibile({ data: [], error: null });
    if (table === 'orders') {
      return {
        insert: (valori: Record<string, unknown>) => {
          inseriti.push(valori);
          return { select: () => ({ single: () => Promise.resolve({ data: { id: `ord-${inseriti.length}` }, error: null }) }) };
        },
        delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    }
    if (table === 'order_items') return { insert: () => Promise.resolve({ error: null }) };
    if (table === 'notifications') return { insert: () => Promise.resolve({ error: null }) };
    return risolvibile({ data: [], error: null });
  };

  const rpc = (name: string) => {
    if (name === 'wallet_debit') return Promise.resolve({ data: 0, error: null });
    return Promise.resolve({ data: null, error: null });
  };

  return {
    getAdminSupabase: () => ({
      from,
      rpc,
      auth: {
        admin: {
          getUserById: (id: string) => new Promise((res) => {
            utentiInVolo.adesso++;
            utentiInVolo.picco = Math.max(utentiInVolo.picco, utentiInVolo.adesso);
            setTimeout(() => {
              utentiInVolo.adesso--;
              res({ data: { user: { id, email: `${id}@test.it` } } });
            }, 5);
          }),
        },
      },
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
      groups: NEGOZI.map((sellerId, i) => ({
        sellerId,
        items: [{ productId: PRODOTTI[i], quantity: 1 }],
      })),
      delivery: { fullName: 'Maria Rossi', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', phone: '3331234567' },
      pickupInStore: false,
      useCredit: false,
    }),
  }) as never;
}

beforeEach(() => {
  lettureProfili.length = 0;
  postaInviata.length = 0;
  inseriti.length = 0;
  utentiInVolo.adesso = 0;
  utentiInVolo.picco = 0;
  vi.resetModules();
});

describe('la posta dopo un ordine in contanti da tre negozi', () => {
  it('legge i nomi dei negozi in una volta sola, non uno per ordine', async () => {
    const { POST } = await import('@/app/api/orders/cod/route');
    const res = await (POST as unknown as (req: never) => Promise<Response>)(richiesta());
    expect(res.status).toBe(200);
    expect(inseriti.length, 'i tre ordini non sono stati creati').toBe(3);
    // La posta parte dopo la risposta: le si lascia il tempo di uscire.
    await new Promise((r) => setTimeout(r, 60));

    expect(
      lettureProfili.filter((l) => l === 'per-uno').length,
      'la tabella dei profili si rilegge ancora una volta per ogni ordine',
    ).toBe(0);
    expect(lettureProfili.filter((l) => l === 'tutti-insieme').length).toBe(1);
  });

  it('manda comunque tutte le email: due per ordine, negozio e cliente', async () => {
    const { POST } = await import('@/app/api/orders/cod/route');
    await (POST as unknown as (req: never) => Promise<Response>)(richiesta());
    await new Promise((r) => setTimeout(r, 60));
    expect(postaInviata.length, 'qualche conferma non e partita').toBe(6);
    expect(postaInviata.filter((m) => m.to === 'cliente@test.it').length).toBe(3);
  });

  it('e i giri verso i negozi partono insieme, non uno dopo l altro', async () => {
    const { POST } = await import('@/app/api/orders/cod/route');
    await (POST as unknown as (req: never) => Promise<Response>)(richiesta());
    await new Promise((r) => setTimeout(r, 60));
    expect(
      utentiInVolo.picco,
      'le letture dei venditori sono ancora una in fila all altra',
    ).toBeGreaterThanOrEqual(2);
  });
});
