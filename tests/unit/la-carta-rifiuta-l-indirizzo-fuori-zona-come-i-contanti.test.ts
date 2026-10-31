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
    expect(km(CASA_FUORI_NORD)).toBeGreaterThan(RAGGIO_CONSEGNA_KM * 1.1);
    expect(km(CASA_FUORI_SUD)).toBeGreaterThan(RAGGIO_CONSEGNA_KM * 1.1);
    expect(km(CASA_FUORI_EST)).toBeGreaterThan(RAGGIO_CONSEGNA_KM * 1.1);
    expect(km(CASA_FUORI_OVEST)).toBeGreaterThan(RAGGIO_CONSEGNA_KM * 1.1);
    expect(km(CASA_DENTRO_NORD)).toBeLessThan(RAGGIO_CONSEGNA_KM * 0.9);
    expect(km(CASA_DENTRO_SUD)).toBeLessThan(RAGGIO_CONSEGNA_KM * 0.9);
    // Nord e sud sono tutta latitudine, est e ovest tutta longitudine.
    expect(CASA_FUORI_NORD.lng).toBe(NEGOZIO.lng);
    expect(CASA_FUORI_EST.lat).toBe(NEGOZIO.lat);
  });

  for (const fonte of FONTI) {
    for (const [dove, casa] of [
      [`${CASA_FUORI_KM} km a nord`, CASA_FUORI_NORD],
      [`${CASA_FUORI_KM} km a sud`, CASA_FUORI_SUD],
      [`${CASA_FUORI_KM} km a est`, CASA_FUORI_EST],
      [`${CASA_FUORI_KM} km a ovest`, CASA_FUORI_OVEST],
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
    ['geocodifica', `${CASA_DENTRO_KM} km a nord`, CASA_DENTRO_NORD],
    ['rubrica', `${CASA_DENTRO_KM} km a sud`, CASA_DENTRO_SUD],
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
      ['il negozio sotto casa primo, il forno fuori dal confine secondo', false],
      ['il forno fuori dal confine primo, il negozio sotto casa secondo', true],
    ] as const) {
      it(`IL CASO DEL COLLAUDO — ${ordine}, casa presa dalla ${fonte}: la carta non apre il pagamento`, async () => {
        const casa = CASA_FUORI_NORD;
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

  it(`tutti e due dentro il confine (sotto casa e a ${CASA_DENTRO_KM} km): il pagamento si apre, una volta sola`, async () => {
    const casa = CASA_DENTRO_NORD;
    state.sellers = [sottoCasa(casa), IL_FORNO];
    casaDalla('geocodifica', casa);
    const res = await POST(await richiestaCon([GRUPPO_SOTTO_CASA, GRUPPO_DEL_FORNO]));
    const corpo = await res.json();
    expect(res.status, JSON.stringify(corpo)).toBe(200);
    expect(createSession).toHaveBeenCalledTimes(1);
  });
});

/**
 * 27/10/2026 (quinto giro della fase 2) — LA CARTA IN OGNI DIREZIONE, COME I CONTANTI.
 *
 * Il collaudo ha fatto misurare alla carta il confine «a quadrato», un asse per volta: una casa a
 * 13 km verso nord-est sta a circa 9,2 km su ognuno dei due assi, e il pagamento si apriva. Le prove
 * qui sopra avevano case solo a nord, sud, est e ovest, quindi restavano tutte verdi. Il difetto
 * opposto, la regola «a rombo» che somma i due assi, rifiuta chi sta dentro: a 9 km in diagonale i
 * due assi sommati fanno 12,7 km, e quella persona non poteva più pagare.
 *
 * Qui la carta riceve le stesse case della prova dei contanti: 13 km nelle otto direzioni, da una
 * fonte per volta (la rubrica degli indirizzi salvati, e l'indirizzo scritto a mano che passa dalla
 * geocodifica), e 9 km nelle quattro diagonali, dove il pagamento si deve aprire. Poi col secondo
 * negozio: il forno a 13 km in diagonale e l'altro sotto casa, nei due ordini.
 */
const RAGGIO_DELLA_TERRA_KM = 6371;
/** Il punto a `km` dal forno nella direzione `gradi` (0 = nord, 90 = est): non usa la funzione che prova. */
function puntoA(km: number, gradi: number): { lat: number; lng: number } {
  const rad = Math.PI / 180;
  const d = km / RAGGIO_DELLA_TERRA_KM;
  const verso = gradi * rad;
  const lat1 = NEGOZIO.lat * rad;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(verso));
  const lng2 =
    NEGOZIO.lng * rad +
    Math.atan2(Math.sin(verso) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: lat2 / rad, lng: lng2 / rad };
}

const DIREZIONI: Array<[string, number]> = [
  ['a nord', 0],
  ['a est', 90],
  ['a sud', 180],
  ['a ovest', 270],
  ['a nord-est', 45],
  ['a sud-est', 135],
  ['a sud-ovest', 225],
  ['a nord-ovest', 315],
];
/** Le direzioni in cui nessuno dei due assi, da solo, arriva al confine. */
const DIAGONALI = DIREZIONI.filter(([, gradi]) => gradi % 90 !== 0);

describe('la carta misura il confine in ogni direzione e da ogni fonte, come i contanti', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.products = [
      { id: P1, name: 'Pane', price: 10, images: ['a.jpg'], seller_id: S1, stock: 50, status: 'available' },
    ];
    state.sellers = [IL_FORNO];
  });

  it(`i punti stanno dove dicono: a ${CASA_FUORI_KM} km in diagonale nessun asse da solo passa il confine, a ${CASA_DENTRO_KM} km i due sommati sì`, () => {
    const km = (c: { lat: number; lng: number }) => haversineKm(NEGOZIO.lat, NEGOZIO.lng, c.lat, c.lng);
    for (const [dove, gradi] of DIREZIONI) {
      expect(km(puntoA(CASA_FUORI_KM, gradi)), `${CASA_FUORI_KM} km ${dove}`).toBeGreaterThan(RAGGIO_CONSEGNA_KM * 1.1);
      expect(km(puntoA(CASA_DENTRO_KM, gradi)), `${CASA_DENTRO_KM} km ${dove}`).toBeLessThan(RAGGIO_CONSEGNA_KM * 0.9);
    }
    expect(DIAGONALI).toHaveLength(4);
    for (const [dove, gradi] of DIAGONALI) {
      const casaFuori = puntoA(CASA_FUORI_KM, gradi);
      expect(km({ lat: casaFuori.lat, lng: NEGOZIO.lng }), `${CASA_FUORI_KM} km ${dove}, la sola latitudine`).toBeLessThan(RAGGIO_CONSEGNA_KM * 0.9);
      expect(km({ lat: NEGOZIO.lat, lng: casaFuori.lng }), `${CASA_FUORI_KM} km ${dove}, la sola longitudine`).toBeLessThan(RAGGIO_CONSEGNA_KM * 0.9);
      const casaDentro = puntoA(CASA_DENTRO_KM, gradi);
      const sommati = km({ lat: casaDentro.lat, lng: NEGOZIO.lng }) + km({ lat: NEGOZIO.lat, lng: casaDentro.lng });
      expect(sommati, `${CASA_DENTRO_KM} km ${dove}, i due assi sommati`).toBeGreaterThan(RAGGIO_CONSEGNA_KM * 1.1);
    }
  });

  for (const fonte of FONTI) {
    for (const [dove, gradi] of DIREZIONI) {
      it(`IL CASO DEL COLLAUDO — una casa a ${CASA_FUORI_KM} km ${dove}, presa dalla ${fonte}: la carta non apre il pagamento`, async () => {
        casaDalla(fonte, puntoA(CASA_FUORI_KM, gradi));
        const res = await POST(richiesta());
        const corpo = (await res.json()) as { error?: { message?: string } };
        expect(res.status, `la rotta della carta ha risposto ${res.status}: ${JSON.stringify(corpo)}`).toBe(400);
        expect(corpo.error?.message).toBe(motivoFuoriZona(NEGOZIO.nome));
        expect(createSession, 'il pagamento con la carta è stato aperto per una casa fuori zona').not.toHaveBeenCalled();
      });
    }
    for (const [dove, gradi] of DIAGONALI) {
      it(`una casa a ${CASA_DENTRO_KM} km ${dove}, presa dalla ${fonte}: dentro il confine il pagamento si apre`, async () => {
        casaDalla(fonte, puntoA(CASA_DENTRO_KM, gradi));
        const res = await POST(richiesta());
        const corpo = await res.json();
        expect(res.status, `una casa dentro i ${RAGGIO_CONSEGNA_KM} km è stata rifiutata: ${JSON.stringify(corpo)}`).toBe(200);
        expect(createSession).toHaveBeenCalledTimes(1);
      });
    }
  }
});

describe('col secondo negozio, la carta misura la diagonale da ognuno dei due', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.products = PRODOTTI_DI_DUE_NEGOZI;
  });

  for (const fonte of FONTI) {
    for (const [ordine, lontanoPrimo] of [
      ['il negozio sotto casa primo, il forno fuori dal confine verso nord-est secondo', false],
      ['il forno fuori dal confine verso nord-est primo, il negozio sotto casa secondo', true],
    ] as const) {
      it(`IL CASO DEL COLLAUDO — ${ordine}, casa presa dalla ${fonte}: la carta non apre il pagamento`, async () => {
        const casa = puntoA(CASA_FUORI_KM, 45);
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

  it(`tutti e due dentro il confine, il forno a ${CASA_DENTRO_KM} km verso sud-ovest: il pagamento si apre, una volta sola`, async () => {
    const casa = puntoA(CASA_DENTRO_KM, 225);
    state.sellers = [IL_FORNO, sottoCasa(casa)];
    casaDalla('rubrica', casa);
    const res = await POST(await richiestaCon([GRUPPO_DEL_FORNO, GRUPPO_SOTTO_CASA]));
    const corpo = await res.json();
    expect(res.status, JSON.stringify(corpo)).toBe(200);
    expect(createSession).toHaveBeenCalledTimes(1);
  });
});

/**
 * 28/10/2026 (sesto giro della fase 2) — UN CERCHIO DI 10 KM, NON UN RIQUADRO IN GRADI.
 *
 * Il collaudo ha fatto misurare alla carta il confine «a riquadro in gradi»: la casa passa se dista
 * meno di 10/111 di grado in latitudine e meno di 10/111 di grado in longitudine. Ma a Piacenza un
 * grado di longitudine vale circa 78,6 km, non 111: quel riquadro è alto 20 km e largo appena 14.
 * Tutte le prove di sopra sono rimaste verdi, perché le loro case stavano a 13 km (fuori anche dal
 * riquadro) oppure a 8-9 km a nord, a sud o in diagonale (dentro anche al riquadro). Sbagliavano due
 * persone vere: chi abita a 12 km verso 35° (nord-nord-est) pagava con la carta, chi abita a 8 km a
 * est veniva rifiutato.
 *
 * Qui la carta riceve quei due casi, e poi tutto il giro: una casa ogni 7,5 gradi, 200 metri dentro il
 * confine (il pagamento si apre) e 200 metri fuori (non si apre), da una fonte per volta. Il riquadro
 * in gradi, il quadrato in chilometri, il rombo, ogni ottagono e un raggio spostato di più di 200 metri
 * sbagliano tutti almeno una di queste case.
 *
 * 28/10/2026 (settimo giro) — ogni 7,5 gradi, non più ogni 15. Il collaudo ha messo un ottagono al
 * posto del cerchio nella rotta dei contanti. Lo stesso ottagono coi lati a 9,83 km, messo nella carta,
 * passava anche qui: con una casa ogni 15 gradi le 102 prove della carta restavano verdi. Con una casa
 * ogni 7,5 gradi non si salva nessun ottagono: la prova dei contanti li conta tutti, da 9 a 11 km.
 */
/** Tutto il giro, una direzione ogni 7,5 gradi (0 = nord, 90 = est). */
const GIRO = Array.from({ length: 48 }, (_, i) => i * 7.5);
// 28/10/2026 — Un cinquantesimo del confine: 200 metri a 10 km, 100 a 5. Con 200 metri e il confine a 5
// un ottagono coi lati a 4,85 km, girato di 3,75°, passava fra le case del giro.
const DENTRO_KM = RAGGIO_CONSEGNA_KM - RAGGIO_CONSEGNA_KM / 50;
const FUORI_KM = RAGGIO_CONSEGNA_KM + RAGGIO_CONSEGNA_KM / 50;
/** Il confine sbagliato del collaudo: 10/111 di grado su tutti e due gli assi, la longitudine non corretta. */
const nelRiquadroInGradi = (c: { lat: number; lng: number }) =>
  Math.abs(c.lat - NEGOZIO.lat) <= RAGGIO_CONSEGNA_KM / KM_PER_GRADO &&
  Math.abs(c.lng - NEGOZIO.lng) <= RAGGIO_CONSEGNA_KM / KM_PER_GRADO;

describe(`la carta misura il confine come un cerchio di ${RAGGIO_CONSEGNA_KM} km, non come un riquadro in gradi`, () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.products = [
      { id: P1, name: 'Pane', price: 10, images: ['a.jpg'], seller_id: S1, stock: 50, status: 'available' },
    ];
    state.sellers = [IL_FORNO];
  });

  it('i punti stanno dove dicono, e il riquadro in gradi li sbaglia (se no le prove sotto non misurano niente)', () => {
    const km = (c: { lat: number; lng: number }) => haversineKm(NEGOZIO.lat, NEGOZIO.lng, c.lat, c.lng);
    expect(km(puntoA(CASA_FUORI_KM, 35))).toBeGreaterThan(RAGGIO_CONSEGNA_KM * 1.1);
    expect(nelRiquadroInGradi(puntoA(CASA_FUORI_KM, 35)), `${CASA_FUORI_KM} km verso 35° deve stare dentro il riquadro`).toBe(true);
    expect(km(puntoA(CASA_DENTRO_KM, 90))).toBeLessThan(RAGGIO_CONSEGNA_KM * 0.9);
    expect(nelRiquadroInGradi(puntoA(CASA_DENTRO_KM, 90)), `${CASA_DENTRO_KM} km a est deve stare fuori dal riquadro`).toBe(false);
    for (const gradi of GIRO) {
      expect(km(puntoA(DENTRO_KM, gradi)), `${DENTRO_KM} km verso ${gradi}°`).toBeCloseTo(DENTRO_KM, 2);
      expect(km(puntoA(FUORI_KM, gradi)), `${FUORI_KM} km verso ${gradi}°`).toBeCloseTo(FUORI_KM, 2);
    }
    // Il giro coglie il riquadro nei due versi: case fuori dal cerchio che ci stanno dentro, e il contrario.
    expect(GIRO.filter((g) => nelRiquadroInGradi(puntoA(FUORI_KM, g)))).toContain(30);
    expect(GIRO.filter((g) => !nelRiquadroInGradi(puntoA(DENTRO_KM, g)))).toContain(90);
  });

  for (const fonte of FONTI) {
    it(`IL CASO DEL COLLAUDO — una casa a ${CASA_FUORI_KM} km verso 35°, presa dalla ${fonte}: la carta non apre il pagamento`, async () => {
      casaDalla(fonte, puntoA(CASA_FUORI_KM, 35));
      const res = await POST(richiesta());
      const corpo = (await res.json()) as { error?: { message?: string } };
      expect(res.status, `la rotta della carta ha risposto ${res.status}: ${JSON.stringify(corpo)}`).toBe(400);
      expect(corpo.error?.message).toBe(motivoFuoriZona(NEGOZIO.nome));
      expect(createSession, `il pagamento con la carta è stato aperto per una casa a ${CASA_FUORI_KM} km`).not.toHaveBeenCalled();
    });

    it(`IL CASO DEL COLLAUDO — una casa a ${CASA_DENTRO_KM} km a est, presa dalla ${fonte}: il pagamento si apre`, async () => {
      casaDalla(fonte, puntoA(CASA_DENTRO_KM, 90));
      const res = await POST(richiesta());
      const corpo = await res.json();
      expect(res.status, `una casa a ${CASA_DENTRO_KM} km è stata rifiutata: ${JSON.stringify(corpo)}`).toBe(200);
      expect(createSession).toHaveBeenCalledTimes(1);
    });

    it(
      `tutto il giro, una casa ogni 7,5 gradi presa dalla ${fonte}: a ${DENTRO_KM} km il pagamento si apre, a ${FUORI_KM} km no`,
      async () => {
        const sbagliate: string[] = [];
        for (const gradi of GIRO) {
          for (const distanza of [DENTRO_KM, FUORI_KM]) {
            createSession.mockClear();
            casaDalla(fonte, puntoA(distanza, gradi));
            const res = await POST(richiesta());
            const corpo = (await res.json()) as { error?: { message?: string } };
            const aperti = createSession.mock.calls.length;
            const giusta =
              distanza < RAGGIO_CONSEGNA_KM
                ? res.status === 200 && aperti === 1
                : res.status === 400 && aperti === 0 && corpo.error?.message === motivoFuoriZona(NEGOZIO.nome);
            if (!giusta) {
              sbagliate.push(`${distanza} km verso ${gradi}°: risposta ${res.status}, pagamento aperto ${aperti} volte`);
            }
          }
        }
        expect(sbagliate, 'la carta sbaglia il confine in queste direzioni').toEqual([]);
      },
      30_000,
    );
  }
});
