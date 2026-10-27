import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RAGGIO_CONSEGNA_KM } from '@/lib/constants';
import { haversineKm } from '@/lib/geo';
import { motivoFuoriZona } from '@/lib/ordini/zona-di-consegna';

/**
 * 27/10/2026 (terzo giro) — IL CONFINE DEI 10 KM VALE ANCHE PER CHI PAGA CON LA CARTA.
 *
 * L'unica prova di rotta sul confine chiamava la strada dei contanti (/api/orders/cod). Il collaudo
 * ha spento il controllo della zona nella rotta della carta (`const fuori = false && …`) e tutte le
 * prove sono rimaste verdi: una casa a 13 km poteva pagare con la carta, e poi qualcuno doveva
 * telefonare per annullare e rimborsare. Qui si chiama la rotta della carta con una casa fuori zona,
 * a nord e a sud (non solo a est: il confine è un cerchio), e una dentro.
 *
 * Stripe, autenticazione e database sono finti; la regola della zona, il conto e la rotta sono veri.
 * Le coordinate della casa arrivano da dove le prende la rotta: gli indirizzi salvati, oppure la
 * geocodifica dell'indirizzo scritto.
 *
 * 27/10/2026 (quarto giro) — UNA FONTE ALLA VOLTA, E IL BROWSER CHE MENTE.
 * Qui sotto le due strade davano la stessa casa: il collaudo ha fatto guardare alla carta solo la
 * rubrica (`coordConsegna` al posto di `coordPerLaMappa`) e tutto è rimasto verde. Ma chi ordina la
 * prima volta non ha la casa in rubrica: la sua posizione arriva solo dalla geocodifica, e con quel
 * difetto una casa a 13 km pagava con la carta. Ora ogni caso accende UNA fonte sola, in quattro
 * direzioni, e il browser giura di stare davanti al negozio: la rotta non deve credergli.
 *
 * 27/10/2026 (quinto giro) — OGNI NEGOZIO DEL CARRELLO, NON SOLO IL PRIMO.
 * Il carrello aveva un negozio solo. Il collaudo ha fatto misurare alla carta solo il primo negozio
 * della lista e tutto è rimasto verde: con il primo negozio sotto casa e il secondo a 13 km, la carta
 * apriva il pagamento per tutti e due, e la spesa del secondo non poteva arrivare. In fondo al file il
 * carrello ha due negozi, uno sotto casa e uno a 13 km, nei due ordini: il lontano primo e il lontano
 * secondo. Il pagamento non si apre in nessuno dei due, e si apre quando tutti e due stanno dentro.
 */

const P1 = '11111111-1111-1111-1111-111111111111';
const S1 = '22222222-2222-2222-2222-222222222222';
const NEGOZIO = { lat: 45.0526, lng: 9.6929, nome: 'Forno di prova' };
// Un grado di latitudine vale circa 111,2 km ovunque: spostarsi lungo il meridiano misura giusto.
const KM_PER_GRADO = 111.195;
const casaA = (km: number) => ({ lat: NEGOZIO.lat + km / KM_PER_GRADO, lng: NEGOZIO.lng });
// Lungo il parallelo un grado di longitudine vale 111,2 km per il coseno della latitudine.
const casaAEst = (km: number) => ({
  lat: NEGOZIO.lat,
  lng: NEGOZIO.lng + km / (KM_PER_GRADO * Math.cos((NEGOZIO.lat * Math.PI) / 180)),
});
const CASA_13_KM_NORD = casaA(13);
const CASA_13_KM_SUD = casaA(-13);
const CASA_13_KM_EST = casaAEst(13);
const CASA_13_KM_OVEST = casaAEst(-13);
const CASA_8_KM_NORD = casaA(8);
const CASA_8_KM_SUD = casaA(-8);

/** Il secondo negozio del carrello: quello sotto casa. */
const P_SOTTO_CASA = '55555555-5555-5555-5555-555555555555';
const S_SOTTO_CASA = '66666666-6666-6666-6666-666666666666';
const SOTTO_CASA = 'Latteria sotto casa';

type Fonte = 'rubrica' | 'geocodifica';
const FONTI: Fonte[] = ['rubrica', 'geocodifica'];

const state: {
  rubrica: { lat: number; lng: number } | null;
  geocodifica: { lat: number; lng: number } | null;
  products: unknown[];
  sellers: unknown[];
} = {
  rubrica: null,
  geocodifica: null,
  products: [],
  sellers: [],
};

/** Accende una fonte sola: l'altra non sa niente della casa. */
function casaDalla(fonte: Fonte, casa: { lat: number; lng: number }) {
  state.rubrica = fonte === 'rubrica' ? casa : null;
  state.geocodifica = fonte === 'geocodifica' ? casa : null;
}

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

/** Il browser manda sempre la posizione del negozio: una bugia comoda, che la rotta deve ignorare. */
function richiesta(): never {
  return new Request('http://localhost/api/stripe/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      groups: [{ sellerId: S1, items: [{ productId: P1, quantity: 1 }], shippingCents: 0 }],
      delivery: {
        fullName: 'Mario Rossi',
        address: 'Via Roma 1',
        city: 'Piacenza',
        zip: '29121',
        phone: '3330000000',
        lat: NEGOZIO.lat,
        lng: NEGOZIO.lng,
      },
      couponDiscountCents: 0,
      pickupDiscountCents: 0,
      pickupInStore: false,
    }),
  }) as never;
}

describe('la rotta della carta rifiuta un indirizzo fuori zona, come quella dei contanti', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.products = [
      { id: P1, name: 'Pane', price: 10, images: ['a.jpg'], seller_id: S1, stock: 50, status: 'available' },
    ];
    state.sellers = [{ id: S1, store_name: NEGOZIO.nome, full_name: null, store_lat: NEGOZIO.lat, store_lng: NEGOZIO.lng }];
  });

  it('i punti stanno dove dicono (se no la prova sotto non misura niente)', () => {
    const km = (c: { lat: number; lng: number }) => haversineKm(NEGOZIO.lat, NEGOZIO.lng, c.lat, c.lng);
    expect(km(CASA_13_KM_NORD)).toBeGreaterThan(RAGGIO_CONSEGNA_KM + 2);
    expect(km(CASA_13_KM_SUD)).toBeGreaterThan(RAGGIO_CONSEGNA_KM + 2);
    expect(km(CASA_13_KM_EST)).toBeGreaterThan(RAGGIO_CONSEGNA_KM + 2);
    expect(km(CASA_13_KM_OVEST)).toBeGreaterThan(RAGGIO_CONSEGNA_KM + 2);
    expect(km(CASA_8_KM_NORD)).toBeLessThan(RAGGIO_CONSEGNA_KM - 1);
    expect(km(CASA_8_KM_SUD)).toBeLessThan(RAGGIO_CONSEGNA_KM - 1);
    // Nord e sud sono tutta latitudine, est e ovest tutta longitudine.
    expect(CASA_13_KM_NORD.lng).toBe(NEGOZIO.lng);
    expect(CASA_13_KM_EST.lat).toBe(NEGOZIO.lat);
  });

  for (const fonte of FONTI) {
    for (const [dove, casa] of [
      ['13 km a nord', CASA_13_KM_NORD],
      ['13 km a sud', CASA_13_KM_SUD],
      ['13 km a est', CASA_13_KM_EST],
      ['13 km a ovest', CASA_13_KM_OVEST],
    ] as const) {
      it(`IL CASO DEL COLLAUDO — una casa ${dove}, presa dalla ${fonte}: la carta non apre il pagamento`, async () => {
        casaDalla(fonte, casa);
        const res = await POST(richiesta());
        const corpo = (await res.json()) as { error?: { message?: string } };
        expect(res.status, `la rotta della carta ha risposto ${res.status}: ${JSON.stringify(corpo)}`).toBe(400);
        expect(corpo.error?.message).toBe(motivoFuoriZona(NEGOZIO.nome));
        expect(createSession, 'il pagamento con la carta è stato aperto per una casa fuori zona').not.toHaveBeenCalled();
      });
    }
  }

  for (const [fonte, dove, casa] of [
    ['geocodifica', '8 km a nord', CASA_8_KM_NORD],
    ['rubrica', '8 km a sud', CASA_8_KM_SUD],
  ] as const) {
    it(`una casa ${dove}, presa dalla ${fonte}, dentro il confine: il pagamento si apre`, async () => {
      casaDalla(fonte, casa);
      const res = await POST(richiesta());
      const corpo = await res.json();
      expect(res.status, JSON.stringify(corpo)).toBe(200);
      expect(createSession).toHaveBeenCalledTimes(1);
    });
  }
});

/** La stessa richiesta di sopra, con il carrello che si vuole. */
async function richiestaCon(groups: unknown[]): Promise<never> {
  const base = (await (richiesta() as unknown as Request).json()) as Record<string, unknown>;
  return new Request('http://localhost/api/stripe/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...base, groups }),
  }) as never;
}

const PRODOTTI_DI_DUE_NEGOZI = [
  { id: P_SOTTO_CASA, name: 'Latte', price: 10, images: ['a.jpg'], seller_id: S_SOTTO_CASA, stock: 50, status: 'available' },
  { id: P1, name: 'Pane', price: 10, images: ['a.jpg'], seller_id: S1, stock: 50, status: 'available' },
];
const GRUPPO_SOTTO_CASA = { sellerId: S_SOTTO_CASA, items: [{ productId: P_SOTTO_CASA, quantity: 1 }], shippingCents: 0 };
const GRUPPO_DEL_FORNO = { sellerId: S1, items: [{ productId: P1, quantity: 1 }], shippingCents: 0 };
const IL_FORNO = { id: S1, store_name: NEGOZIO.nome, full_name: null, store_lat: NEGOZIO.lat, store_lng: NEGOZIO.lng };
/** Il negozio sotto casa sta esattamente dove sta la casa. */
const sottoCasa = (casa: { lat: number; lng: number }) => ({
  id: S_SOTTO_CASA,
  store_name: SOTTO_CASA,
  full_name: null,
  store_lat: casa.lat,
  store_lng: casa.lng,
});

describe('con due negozi nel carrello, la carta misura il confine da ognuno dei due', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.products = PRODOTTI_DI_DUE_NEGOZI;
  });

  for (const fonte of FONTI) {
    for (const [ordine, lontanoPrimo] of [
      ['il negozio sotto casa primo, il forno a 13 km secondo', false],
      ['il forno a 13 km primo, il negozio sotto casa secondo', true],
    ] as const) {
      it(`IL CASO DEL COLLAUDO — ${ordine}, casa presa dalla ${fonte}: la carta non apre il pagamento`, async () => {
        const casa = CASA_13_KM_NORD;
        // L'ordine conta due volte: nella lista dei negozi letta dal database e nel carrello.
        state.sellers = lontanoPrimo ? [IL_FORNO, sottoCasa(casa)] : [sottoCasa(casa), IL_FORNO];
        casaDalla(fonte, casa);
        const res = await POST(
          await richiestaCon(lontanoPrimo ? [GRUPPO_DEL_FORNO, GRUPPO_SOTTO_CASA] : [GRUPPO_SOTTO_CASA, GRUPPO_DEL_FORNO]),
        );
        const corpo = (await res.json()) as { error?: { message?: string } };
        expect(res.status, `la rotta della carta ha risposto ${res.status}: ${JSON.stringify(corpo)}`).toBe(400);
        expect(corpo.error?.message).toBe(motivoFuoriZona(NEGOZIO.nome));
        expect(createSession, 'la carta ha aperto il pagamento con un negozio del carrello fuori zona').not.toHaveBeenCalled();
      });
    }
  }

  it('tutti e due dentro il confine (sotto casa e a 8 km): il pagamento si apre, una volta sola', async () => {
    const casa = CASA_8_KM_NORD;
    state.sellers = [sottoCasa(casa), IL_FORNO];
    casaDalla('geocodifica', casa);
    const res = await POST(await richiestaCon([GRUPPO_SOTTO_CASA, GRUPPO_DEL_FORNO]));
    const corpo = await res.json();
    expect(res.status, JSON.stringify(corpo)).toBe(200);
    expect(createSession).toHaveBeenCalledTimes(1);
  });
});
