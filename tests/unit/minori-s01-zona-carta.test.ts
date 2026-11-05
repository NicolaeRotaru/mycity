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
/**
 * 28/10/2026 — IL CONFINE È SCESO A 5 KM (correzione di Nicola): LE CASE SI MISURANO DAL CONFINE.
 *
 * Fino al 27/10 le case di queste prove stavano a 8-9 km (dentro) e a 12-13 km (fuori) da un confine di 10. Col confine a 5 la casa
 * «dentro» era fuori, e la casa lontana in diagonale non metteva più alla prova la misura fatta un
 * asse per volta: ogni asse, da solo, superava già i 5 km. Adesso le due distanze si leggono dal
 * confine: dentro a quattro quinti (4 km col confine a 5), fuori a sei quinti (6 km). In diagonale,
 * a 6 km, nessun asse da solo arriva al confine (4,2 km ciascuno); a 4 km i due assi sommati lo
 * superano (5,7 km): un confine «a quadrato» e uno «a rombo» restano rossi, anche col secondo
 * negozio. Questa prova controlla il MECCANISMO e non va riscritta quando cambia il NUMERO: il numero
 * lo inchioda tests/unit/al-lancio-si-consegna-in-bici-fino-a-5-km.test.ts.
 */
const CASA_DENTRO_KM = RAGGIO_CONSEGNA_KM - RAGGIO_CONSEGNA_KM / 5;
const CASA_FUORI_KM = RAGGIO_CONSEGNA_KM + RAGGIO_CONSEGNA_KM / 5;
const CASA_FUORI_NORD = casaA(CASA_FUORI_KM);
const CASA_FUORI_SUD = casaA(-CASA_FUORI_KM);
const CASA_FUORI_EST = casaAEst(CASA_FUORI_KM);
const CASA_FUORI_OVEST = casaAEst(-CASA_FUORI_KM);
const CASA_DENTRO_NORD = casaA(CASA_DENTRO_KM);
const CASA_DENTRO_SUD = casaA(-CASA_DENTRO_KM);

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

// 31/10/2026 — Al lancio la carta è spenta (CARTA_ACCESA in lib/funzioni-al-lancio.ts) e la rotta
// la rifiuta anche con le chiavi. Questa prova misura il percorso della carta: la accende per finta.
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

/**
 * S01 — 2077: le prove della carta avevano solo un carrello da 10 €. Il controllo
 * zona si poteva togliere sopra i 30 € di spesa (dove la consegna cambia regola)
 * e tutto restava verde. Qui lo stesso caso con una spesa da 35 €.
 */
describe('S01 / 2077 — fuori zona anche con una spesa sopra i 30 €', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.products = [
      { id: P1, name: 'Pane', price: 35, images: ['a.jpg'], seller_id: S1, stock: 50, status: 'available' },
    ];
    state.sellers = [{ id: S1, store_name: NEGOZIO.nome, full_name: null, store_lat: NEGOZIO.lat, store_lng: NEGOZIO.lng }];
  });
  for (const fonte of FONTI) {
    it(`35 € di spesa, casa a ${CASA_FUORI_KM} km a nord dalla ${fonte}: la carta non apre il pagamento`, async () => {
      casaDalla(fonte, CASA_FUORI_NORD);
      const res = await POST(richiesta());
      expect(res.status).toBe(400);
      expect(createSession).not.toHaveBeenCalled();
    });
  }
  it('controprova: 35 € e casa dentro il confine, il pagamento si apre', async () => {
    casaDalla('geocodifica', CASA_DENTRO_NORD);
    const res = await POST(richiesta());
    expect(res.status, JSON.stringify(await res.json())).toBe(200);
  });
});
