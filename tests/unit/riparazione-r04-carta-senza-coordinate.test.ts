import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FASCE_DI_DOMANI } from '@/lib/quando-arriva';

/**
 * R04-011 — CON LA CARTA, UN INDIRIZZO SENZA COORDINATE PASSAVA IN SILENZIO.
 *
 * Se l'indirizzo del cliente non si trova sulla mappa (né in rubrica né dalla geocodifica), o il
 * negozio non ha la posizione sulla vetrina, la rotta della carta non può misurare il confine:
 * `fuoriZonaDiConsegna` dice «no» quando non sa, e il pagamento si apre. Fin qui come i contanti.
 * Ma i contanti (R31-018, app/api/orders/cod/route.ts) lasciano un segno agli amministratori — la
 * campanella «distanza non misurata» — e la carta no: nessuno sapeva quale consegna guardare a mano.
 * Adesso la carta segue la stessa regola: passa, e gli amministratori ricevono la campanella.
 *
 * Rotta vera; autenticazione, Stripe e database finti. I lavori «dopo la risposta» si raccolgono e
 * si fanno girare a mano; gli avvisi agli amministratori si contano.
 */

const P1 = '11111111-1111-1111-1111-111111111111';
const S1 = '22222222-2222-2222-2222-222222222222';
const NEGOZIO = { lat: 45.0526, lng: 9.6929, nome: 'Forno di prova' };
type Coord = { lat: number; lng: number };
/** Una casa a 2 km a nord del negozio: dentro il confine. */
const CASA_VICINA: Coord = { lat: NEGOZIO.lat + 2 / 111.195, lng: NEGOZIO.lng };

const state: {
  rubrica: Coord | null;
  geocodifica: Coord | null;
  products: unknown[];
  sellers: unknown[];
} = { rubrica: null, geocodifica: null, products: [], sellers: [] };

const dopo: Array<() => Promise<void>> = [];
const avvisi: Array<{ titolo: string; corpo: string; link: string }> = [];

const createSession = vi.fn(async (_input: unknown) => ({ id: 'cs_test', url: 'https://stripe.test/cs_test' }));

// Al lancio la carta è spenta (CARTA_ACCESA): questa prova misura il percorso della carta, la accende per finta.
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
  RiservaTroppoCorta: class RiservaTroppoCorta extends Error {},
}));
vi.mock('@/lib/coupons', () => ({ validateCoupon: vi.fn(async () => ({ ok: false, reason: 'no' })) }));
vi.mock('@/lib/api/dopo-la-risposta', () => ({
  dopoLaRisposta: (lavoro: () => Promise<void>) => {
    dopo.push(lavoro);
  },
}));
vi.mock('@/lib/stripe/webhook/comune', async (originale) => ({
  ...((await originale()) as Record<string, unknown>),
  notifyAdmins: vi.fn(async (titolo: string, corpo: string, link: string) => {
    avvisi.push({ titolo, corpo, link });
    return 'scritto';
  }),
}));
// Le due strade da cui la rotta prende la posizione della casa.
vi.mock('@/lib/shipping-coordinate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/shipping-coordinate')>();
  return { ...actual, coordinateDaIndirizziSalvati: vi.fn(async () => state.rubrica) };
});
vi.mock('@/lib/geocodifica', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/geocodifica')>();
  return { ...actual, coordinateDiUnIndirizzo: vi.fn(async () => state.geocodifica) };
});

vi.mock('@/lib/supabase/server', () => {
  const serverFrom = vi.fn((table: string) => {
    if (table === 'products') {
      return { select: () => ({ in: () => Promise.resolve({ data: state.products, error: null }) }) };
    }
    return { select: () => ({ in: () => Promise.resolve({ data: state.sellers, error: null }) }) };
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
                data: { id: 'pc_12345678abcd', expires_at: new Date(Date.now() + 2 * 3600_000).toISOString() },
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
    return { insert: () => Promise.resolve({ error: null }) };
  });
  const rpc = vi.fn(() => Promise.resolve({ data: 0, error: null }));
  return {
    getServerSupabase: vi.fn(() => ({ from: serverFrom, rpc })),
    getAdminSupabase: vi.fn(() => ({ from: adminFrom, rpc })),
  };
});

import { POST } from '@/app/api/stripe/checkout/route';

/** Il browser giura di stare davanti al negozio: la rotta non deve credergli. */
function richiesta(): never {
  return new Request('http://localhost/api/stripe/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      groups: [{ sellerId: S1, items: [{ productId: P1, quantity: 1 }], shippingCents: 0 }],
      delivery: {
        fullName: 'Mario Rossi',
        address: 'Via che non esiste 99',
        city: 'Piacenza',
        zip: '29121',
        phone: '3330000000',
        lat: NEGOZIO.lat,
        lng: NEGOZIO.lng,
      },
      couponDiscountCents: 0,
      pickupDiscountCents: 0,
      pickupInStore: false,
      deliverySlot: FASCE_DI_DOMANI[0],
    }),
  }) as never;
}

async function paga() {
  const res = await POST(richiesta());
  const corpo = await res.json();
  for (const lavoro of dopo.splice(0)) await lavoro();
  return { res, corpo };
}

const segni = () => avvisi.filter((a) => /distanza non misurata/i.test(a.titolo));

function negozio(posizione: Coord | null) {
  return { id: S1, store_name: NEGOZIO.nome, full_name: null, store_lat: posizione?.lat ?? null, store_lng: posizione?.lng ?? null };
}

describe('R04-011 · con la carta, chi non si può misurare passa ma non in silenzio (come i contanti)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Un mercoledì mattina a Piacenza: la fascia di domani è sempre lontana più di un'ora.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-18T09:00:00Z'));
    dopo.length = 0;
    avvisi.length = 0;
    state.rubrica = null;
    state.geocodifica = null;
    state.products = [
      { id: P1, name: 'Pane', price: 10, images: ['a.jpg'], seller_id: S1, stock: 50, status: 'available' },
    ];
    state.sellers = [negozio(NEGOZIO)];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('IL CASO DELLA VOCE — indirizzo che non si trova sulla mappa: il pagamento si apre e gli amministratori lo sanno, col perché', async () => {
    const { res, corpo } = await paga();
    expect(res.status, JSON.stringify(corpo)).toBe(200);
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(segni(), 'il pagamento con la carta è stato aperto senza misura e senza avviso agli amministratori').toHaveLength(1);
    expect(segni()[0].corpo).toContain('non si trova sulla mappa');
    expect(segni()[0].corpo).toContain(NEGOZIO.nome);
    expect(segni()[0].corpo).toContain('pc_12345');
  });

  it('negozio senza posizione sulla vetrina, casa trovata: il pagamento si apre e gli amministratori lo sanno, col perché', async () => {
    state.sellers = [negozio(null)];
    state.geocodifica = CASA_VICINA;
    const { res, corpo } = await paga();
    expect(res.status, JSON.stringify(corpo)).toBe(200);
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(segni()).toHaveLength(1);
    expect(segni()[0].corpo).toContain('il negozio non ha la posizione sulla mappa');
  });

  it('negozio e casa sulla mappa, dentro il confine: nessun segno', async () => {
    state.rubrica = CASA_VICINA;
    const { res, corpo } = await paga();
    expect(res.status, JSON.stringify(corpo)).toBe(200);
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(segni()).toHaveLength(0);
  });

  it('se Stripe non apre il pagamento, nessun segno: non c’è niente da guardare', async () => {
    createSession.mockRejectedValueOnce(new Error('stripe giù'));
    const { res } = await paga();
    expect(res.status).toBe(500);
    expect(segni()).toHaveLength(0);
  });
});
