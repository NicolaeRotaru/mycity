import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RAGGIO_CONSEGNA_KM } from '@/lib/constants';
import { haversineKm } from '@/lib/geo';
import { motivoFuoriZona } from '@/lib/ordini/zona-di-consegna';

/**
 * 27/10/2026 (quarto giro) — LA CASSA IN CONTANTI MISURA IL CONFINE IN OGNI DIREZIONE, DA OGNI FONTE.
 *
 * Le prove della rotta dei contanti avevano una casa sola fuori zona: Milano, che sta a nord-ovest.
 * Il collaudo ha fatto ignorare la latitudine alla rotta (la casa misurata come se stesse all'altezza
 * del negozio) e tutto è rimasto verde: Milano è lontana anche solo in longitudine, quindi veniva
 * rifiutata lo stesso. Così una casa 13 km a nord, o a sud, poteva ordinare e pagare alla consegna.
 *
 * Qui la rotta vera riceve una casa a 13 km in tutte e quattro le direzioni, e ogni volta da tutte
 * e due le strade da cui la rotta prende le coordinate: la rubrica degli indirizzi salvati, oppure la
 * geocodifica dell'indirizzo scritto la prima volta. Il browser intanto giura di stare davanti al
 * negozio: la rotta non deve credergli. Dentro il confine, a 9 km, l'ordine nasce, e porta le
 * coordinate misurate dal server.
 *
 * 27/10/2026 (quinto giro) — ANCHE IN DIAGONALE. Il collaudo ha fatto misurare alla rotta un asse
 * per volta: prima tutta la latitudine, poi tutta la longitudine, ognuna contro i 10 km. Le quattro
 * case qui sopra stanno ognuna su un asse solo, quindi venivano rifiutate lo stesso e tutto restava
 * verde. Una casa a 13 km verso nord-est però è a circa 9,2 km su ognuno dei due assi: con quel
 * difetto ordinava e pagava alla consegna. Adesso le direzioni sono otto, e a 9 km in diagonale
 * l'ordine deve nascere: così cade anche il difetto opposto, una regola che somma i due assi
 * (9 km in diagonale fanno 12,7 km sommati) e rifiuta chi sta dentro il confine.
 *
 * Autenticazione e database sono finti; la regola della zona e la rotta sono vere.
 */

type Coord = { lat: number; lng: number };
type Fonte = 'rubrica' | 'geocodifica';

const NEGOZIO_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const PRODOTTO = '11111111-1111-1111-1111-111111111111';
const NEGOZIO = { lat: 45.0526, lng: 9.6929, nome: 'Pane Quotidiano' };

const RAGGIO_DELLA_TERRA_KM = 6371;
/** Il punto a `km` dal negozio nella direzione `gradi` (0 = nord, 90 = est): non usa la funzione che prova. */
function puntoA(km: number, gradi: number): Coord {
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
const FONTI: Fonte[] = ['rubrica', 'geocodifica'];

const fonti: Record<Fonte, Coord | null> = { rubrica: null, geocodifica: null };
const ordiniCreati: Array<Record<string, unknown>> = [];
const chiamateRpc: string[] = [];
/** Il carrello con più negozi: acceso, il database finto risponde con questi al posto del negozio solo. */
const carrello: { venditori: unknown[] | null; prodotti: unknown[] | null } = { venditori: null, prodotti: null };

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (
      _o: unknown,
      h: (ctx: { user: { id: string; email: string; email_confirmed_at: string }; profile: unknown; req: unknown }) => unknown,
    ) =>
    (req: unknown) =>
      h({
        user: { id: 'cliente-1', email: 'cliente@test.it', email_confirmed_at: '2026-01-01T00:00:00Z' },
        profile: { role: 'buyer', is_approved: true },
        req,
      }),
  assertCanPurchase: vi.fn(() => null),
}));
vi.mock('@/lib/store-hours', () => ({
  negozioPuoServire: vi.fn(() => true),
  motivoNegozioChiuso: vi.fn((n: string) => `${n} è chiuso.`),
}));
vi.mock('@/lib/promotions', () => ({
  fetchActiveDiscounts: vi.fn(async () => new Map()),
  discountedUnitCents: vi.fn((prezzo: number) => Math.round(prezzo * 100)),
}));
vi.mock('@/lib/coupons', () => ({ validateCoupon: vi.fn(async () => ({ ok: false, reason: 'nessun codice' })) }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/api/dopo-la-risposta', () => ({ dopoLaRisposta: vi.fn() }));
// Le due strade da cui la rotta prende la posizione della casa. Ogni caso ne accende una sola.
vi.mock('@/lib/shipping-coordinate', () => ({ coordinateDaIndirizziSalvati: vi.fn(async () => fonti.rubrica) }));
vi.mock('@/lib/geocodifica', () => ({ coordinateDiUnIndirizzo: vi.fn(async () => fonti.geocodifica) }));

vi.mock('@/lib/supabase/server', () => {
  const prodotti = [
    { id: PRODOTTO, seller_id: NEGOZIO_ID, name: 'Pane', price: 12, stock: 10, has_variants: false, images: [], status: 'available' },
  ];
  const venditori = [
    { id: NEGOZIO_ID, store_name: NEGOZIO.nome, store_lat: NEGOZIO.lat, store_lng: NEGOZIO.lng, store_hours: null },
  ];
  /** Una catena di query che accetta ogni passo e alla fine risponde `lista` (o `singolo`, per una riga). */
  const catena = (lista: unknown, singolo: unknown = { data: null, error: null }) => {
    const b: Record<string, unknown> = {};
    for (const passo of ['select', 'eq', 'neq', 'in', 'is', 'gt', 'gte', 'lt', 'lte', 'filter', 'order', 'limit', 'not', 'or', 'update', 'upsert', 'delete', 'insert']) {
      b[passo] = () => b;
    }
    b.single = () => Promise.resolve(singolo);
    b.maybeSingle = () => Promise.resolve(singolo);
    b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(lista).then(ok, ko);
    return b;
  };
  const from = (tavola: string): Record<string, unknown> => {
    if (tavola === 'products') return catena({ data: carrello.prodotti ?? prodotti, error: null });
    if (tavola === 'seller_public_profiles') return catena({ data: carrello.venditori ?? venditori, error: null });
    if (tavola === 'orders') {
      const c = catena({ data: [], error: null });
      c.insert = (riga: unknown) => {
        ordiniCreati.push((Array.isArray(riga) ? riga[0] : riga) as Record<string, unknown>);
        return catena({ data: [{ id: 'ord-1' }], error: null }, { data: { id: 'ord-1' }, error: null });
      };
      return c;
    }
    return catena({ data: [], error: null });
  };
  return {
    getAdminSupabase: () => ({
      from,
      rpc: (nome: string) => {
        chiamateRpc.push(nome);
        return Promise.resolve({ data: null, error: null });
      },
      auth: { admin: { getUserById: async () => ({ data: { user: { email: 'negozio@test.it' } } }) } },
    }),
    getServerSupabase: async () => ({ from }),
  };
});

/** L'ordine in contanti. Il browser dice di stare davanti al negozio: la rotta non deve fidarsi. */
function ordina(groups: unknown[] = [{ sellerId: NEGOZIO_ID, items: [{ productId: PRODOTTO, quantity: 1 }] }]): never {
  return new Request('http://localhost/api/orders/cod', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      groups,
      delivery: {
        fullName: 'Maria Rossi',
        address: 'Via Emilia 1',
        city: 'Piacenza',
        zip: '29121',
        phone: '3331234567',
        lat: NEGOZIO.lat,
        lng: NEGOZIO.lng,
      },
      pickupInStore: false,
      useCredit: false,
    }),
  }) as never;
}

async function paga(casa: Coord, fonte: Fonte, groups?: unknown[]) {
  fonti.rubrica = fonte === 'rubrica' ? casa : null;
  fonti.geocodifica = fonte === 'geocodifica' ? casa : null;
  const { POST } = await import('@/app/api/orders/cod/route');
  const res = await (POST as unknown as (req: never) => Promise<Response>)(ordina(groups));
  const corpo = (await res.json()) as { error?: { message?: string } };
  return { res, corpo };
}

beforeEach(() => {
  ordiniCreati.length = 0;
  chiamateRpc.length = 0;
  fonti.rubrica = null;
  fonti.geocodifica = null;
  carrello.venditori = null;
  carrello.prodotti = null;
});

describe('la cassa in contanti misura il confine in ogni direzione, da ogni fonte', () => {
  it('i punti stanno dove dicono (se no le prove sotto non misurano niente)', () => {
    for (const [dove, gradi] of DIREZIONI) {
      const a13 = haversineKm(NEGOZIO.lat, NEGOZIO.lng, puntoA(13, gradi).lat, puntoA(13, gradi).lng);
      const a9 = haversineKm(NEGOZIO.lat, NEGOZIO.lng, puntoA(9, gradi).lat, puntoA(9, gradi).lng);
      expect(a13, `13 km ${dove}`).toBeGreaterThan(RAGGIO_CONSEGNA_KM + 2);
      expect(a9, `9 km ${dove}`).toBeLessThan(RAGGIO_CONSEGNA_KM - 0.5);
    }
    // Nord e sud stanno sul meridiano del negozio: la distanza è TUTTA latitudine.
    expect(Math.abs(puntoA(13, 0).lng - NEGOZIO.lng)).toBeLessThan(1e-9);
    expect(Math.abs(puntoA(13, 180).lng - NEGOZIO.lng)).toBeLessThan(1e-9);
    // In diagonale, a 13 km, né la sola latitudine né la sola longitudine superano il confine:
    // è il caso che una misura fatta un asse per volta lascia passare.
    expect(DIAGONALI).toHaveLength(4);
    for (const [dove, gradi] of DIAGONALI) {
      const casa = puntoA(13, gradi);
      const soloLatitudine = haversineKm(NEGOZIO.lat, NEGOZIO.lng, casa.lat, NEGOZIO.lng);
      const soloLongitudine = haversineKm(NEGOZIO.lat, NEGOZIO.lng, NEGOZIO.lat, casa.lng);
      expect(soloLatitudine, `13 km ${dove}, la sola latitudine`).toBeLessThan(RAGGIO_CONSEGNA_KM - 0.5);
      expect(soloLongitudine, `13 km ${dove}, la sola longitudine`).toBeLessThan(RAGGIO_CONSEGNA_KM - 0.5);
      // E a 9 km in diagonale i due assi sommati superano il confine: la regola che somma sbaglierebbe.
      const a9 = puntoA(9, gradi);
      const sommati =
        haversineKm(NEGOZIO.lat, NEGOZIO.lng, a9.lat, NEGOZIO.lng) + haversineKm(NEGOZIO.lat, NEGOZIO.lng, NEGOZIO.lat, a9.lng);
      expect(sommati, `9 km ${dove}, i due assi sommati`).toBeGreaterThan(RAGGIO_CONSEGNA_KM + 2);
    }
  });

  for (const fonte of FONTI) {
    for (const [dove, gradi] of DIREZIONI) {
      it(`IL CASO DEL COLLAUDO — una casa a 13 km ${dove}, presa dalla ${fonte}: l'ordine non nasce`, async () => {
        const { res, corpo } = await paga(puntoA(13, gradi), fonte);
        expect(res.status, `la rotta dei contanti ha risposto ${res.status}: ${JSON.stringify(corpo)}`).toBe(400);
        expect(corpo.error?.message).toBe(motivoFuoriZona(NEGOZIO.nome));
        expect(ordiniCreati, 'è nato un ordine in contanti che nessuno può consegnare').toHaveLength(0);
        expect(chiamateRpc, 'il rifiuto per zona ha già riservato la merce').not.toContain('reserve_stock');
      });
    }
  }

  for (const [fonte, dove, gradi] of [
    ['geocodifica', 'a nord', 0],
    ['rubrica', 'a sud', 180],
    ['geocodifica', 'a ovest', 270],
    ['rubrica', 'a est', 90],
    ['rubrica', 'a nord-est', 45],
    ['geocodifica', 'a sud-ovest', 225],
  ] as Array<[Fonte, string, number]>) {
    it(`una casa a 9 km ${dove}, presa dalla ${fonte}: dentro il confine l'ordine nasce, con la casa misurata dal server`, async () => {
      const casa = puntoA(9, gradi);
      const { corpo } = await paga(casa, fonte);
      expect(corpo.error?.message, 'una casa dentro i 10 km è stata rifiutata per zona').not.toBe(motivoFuoriZona(NEGOZIO.nome));
      expect(ordiniCreati, `l'ordine dentro il confine non è nato: ${JSON.stringify(corpo)}`).toHaveLength(1);
      expect(ordiniCreati[0].delivery_lat).toBeCloseTo(casa.lat, 9);
      expect(ordiniCreati[0].delivery_lng).toBeCloseTo(casa.lng, 9);
    });
  }
});

/**
 * 27/10/2026 (quinto giro) — OGNI NEGOZIO DEL CARRELLO, NON SOLO IL PRIMO. Il collaudo ha fatto
 * misurare alla carta solo il primo negozio della lista; la rotta dei contanti ha lo stesso giro su
 * tutti i negozi, e le sue prove avevano un negozio solo. Qui il carrello ne ha due: uno sotto casa e
 * il forno a 13 km, nei due ordini. L'ordine non nasce per nessuno dei due.
 */
describe('con due negozi nel carrello, la cassa in contanti misura il confine da ognuno dei due', () => {
  const SOTTO_CASA_ID = 'aaaaaaaa-0000-0000-0000-000000000002';
  const LATTE = '11111111-1111-1111-1111-111111111112';
  const prodotto = (id: string, negozio: string) => ({
    id,
    seller_id: negozio,
    name: 'Pane',
    price: 12,
    stock: 10,
    has_variants: false,
    images: [],
    status: 'available',
  });
  const negozio = (id: string, nome: string, dove: Coord) => ({ id, store_name: nome, store_lat: dove.lat, store_lng: dove.lng, store_hours: null });
  const IL_FORNO = negozio(NEGOZIO_ID, NEGOZIO.nome, NEGOZIO);
  const GRUPPO_SOTTO_CASA = { sellerId: SOTTO_CASA_ID, items: [{ productId: LATTE, quantity: 1 }] };
  const GRUPPO_DEL_FORNO = { sellerId: NEGOZIO_ID, items: [{ productId: PRODOTTO, quantity: 1 }] };

  /** Il negozio sotto casa sta esattamente dove sta la casa; il forno resta dov'è. */
  function dueNegozi(casa: Coord, lontanoPrimo: boolean): unknown[] {
    const sottoCasa = negozio(SOTTO_CASA_ID, 'Latteria sotto casa', casa);
    carrello.venditori = lontanoPrimo ? [IL_FORNO, sottoCasa] : [sottoCasa, IL_FORNO];
    carrello.prodotti = [prodotto(PRODOTTO, NEGOZIO_ID), prodotto(LATTE, SOTTO_CASA_ID)];
    return lontanoPrimo ? [GRUPPO_DEL_FORNO, GRUPPO_SOTTO_CASA] : [GRUPPO_SOTTO_CASA, GRUPPO_DEL_FORNO];
  }

  for (const fonte of FONTI) {
    for (const [ordine, lontanoPrimo] of [
      ['il negozio sotto casa primo, il forno a 13 km secondo', false],
      ['il forno a 13 km primo, il negozio sotto casa secondo', true],
    ] as const) {
      it(`${ordine}, casa presa dalla ${fonte}: l'ordine non nasce`, async () => {
        const casa = puntoA(13, 0);
        const { res, corpo } = await paga(casa, fonte, dueNegozi(casa, lontanoPrimo));
        expect(res.status, `la rotta dei contanti ha risposto ${res.status}: ${JSON.stringify(corpo)}`).toBe(400);
        expect(corpo.error?.message).toBe(motivoFuoriZona(NEGOZIO.nome));
        expect(ordiniCreati, 'è nato un ordine in contanti con un negozio del carrello fuori zona').toHaveLength(0);
        expect(chiamateRpc, 'il rifiuto per zona ha già riservato la merce').not.toContain('reserve_stock');
      });
    }
  }

  it('tutti e due dentro il confine (sotto casa e a 9 km): nascono i due ordini', async () => {
    const casa = puntoA(9, 0);
    const { corpo } = await paga(casa, 'geocodifica', dueNegozi(casa, false));
    expect(corpo.error?.message, 'due negozi dentro i 10 km sono stati rifiutati per zona').not.toBe(motivoFuoriZona(NEGOZIO.nome));
    expect(ordiniCreati, `gli ordini dentro il confine non sono nati: ${JSON.stringify(corpo)}`).toHaveLength(2);
  });
});

/**
 * 28/10/2026 (settimo giro della fase 2) — UN CERCHIO DI 10 KM: NON UNO DA 12, E NON UN OTTAGONO.
 *
 * Il collaudo ha messo nella rotta dei contanti due confini sbagliati, uno per volta, e tutte le
 * prove di sopra sono rimaste verdi. Le loro case stavano a 13 km, fuori anche da quei confini,
 * oppure a 9 km, dentro anche a quelli:
 *  · un raggio di 12 km: chi abita a 11 km ordinava e pagava alla consegna una spesa che nessuno
 *    gli può portare;
 *  · un ottagono al posto del cerchio: giusto sulle otto direzioni delle prove di sopra, sbagliato
 *    fra l'una e l'altra, dove gli spigoli escono dal cerchio e i lati ci rientrano.
 *
 * Qui la rotta riceve tutto il giro: una casa ogni 7,5 gradi, 200 metri dentro il confine (l'ordine
 * nasce) e 200 metri fuori (non nasce), da una fonte per volta. Ogni 7,5 gradi e non ogni 15: con
 * una casa ogni 15 gradi un ottagono della misura giusta (i lati a 9,83 km) passava ancora fra una
 * casa e l'altra. La prima prova qui sotto lo conta, su ogni ottagono da 9 a 11 km girato in ogni verso.
 */
describe('la cassa in contanti misura il confine come un cerchio di 10 km, non uno da 12 e non un ottagono', () => {
  /** Tutto il giro, una direzione ogni 7,5 gradi (0 = nord, 90 = est). */
  const GIRO = Array.from({ length: 48 }, (_, i) => i * 7.5);
  const DENTRO_KM = RAGGIO_CONSEGNA_KM - 0.2;
  const FUORI_KM = RAGGIO_CONSEGNA_KM + 0.2;
  /**
   * Un ottagono col centro sul negozio: i lati stanno a `apotema` km, il primo guarda verso `rotazione`
   * gradi. Una casa ci sta dentro se, misurata verso il lato più vicino, non lo supera.
   */
  const nellOttagono = (km: number, gradi: number, apotema: number, rotazione: number) => {
    const dalLato = ((((gradi - rotazione) % 45) + 45 + 22.5) % 45) - 22.5;
    return km * Math.cos((dalLato * Math.PI) / 180) <= apotema;
  };
  /** Quante case di un giro sbaglia un confine: quelle dentro che rifiuta, più quelle fuori che accetta. */
  const caseSbagliate = (giro: number[], accetta: (km: number, gradi: number) => boolean) =>
    giro.filter((g) => !accetta(DENTRO_KM, g) || accetta(FUORI_KM, g)).length;

  it('le case stanno dove dicono, e sbagliano il raggio da 12 km e ogni ottagono (se no la prova sotto non misura niente)', () => {
    for (const gradi of GIRO) {
      const km = (d: number) => haversineKm(NEGOZIO.lat, NEGOZIO.lng, puntoA(d, gradi).lat, puntoA(d, gradi).lng);
      expect(km(DENTRO_KM), `${DENTRO_KM} km verso ${gradi}°`).toBeCloseTo(DENTRO_KM, 2);
      expect(km(FUORI_KM), `${FUORI_KM} km verso ${gradi}°`).toBeCloseTo(FUORI_KM, 2);
    }
    expect(caseSbagliate(GIRO, (km) => km <= 12), 'il raggio da 12 km del collaudo').toBeGreaterThan(0);
    const salvi: string[] = [];
    for (let rotazione = 0; rotazione < 45; rotazione += 0.5) {
      for (let centesimi = 900; centesimi <= 1100; centesimi++) {
        const apotema = centesimi / 100;
        if (caseSbagliate(GIRO, (km, g) => nellOttagono(km, g, apotema, rotazione)) === 0) {
          salvi.push(`lati a ${apotema} km, girato di ${rotazione}°`);
        }
      }
    }
    expect(salvi, 'questi ottagoni passano fra le case del giro').toEqual([]);
    // Con una casa ogni 15 gradi, invece, l'ottagono coi lati a 9,83 km non ne sbaglia nessuna.
    const ogni15Gradi = GIRO.filter((g) => g % 15 === 0);
    expect(ogni15Gradi).toHaveLength(24);
    expect(caseSbagliate(ogni15Gradi, (km, g) => nellOttagono(km, g, 9.83, 0))).toBe(0);
  });

  for (const fonte of FONTI) {
    it(`IL CASO DEL COLLAUDO — una casa a 11 km verso nord-est, presa dalla ${fonte}: l'ordine non nasce`, async () => {
      const { res, corpo } = await paga(puntoA(11, 45), fonte);
      expect(res.status, `la rotta dei contanti ha risposto ${res.status}: ${JSON.stringify(corpo)}`).toBe(400);
      expect(corpo.error?.message).toBe(motivoFuoriZona(NEGOZIO.nome));
      expect(ordiniCreati, 'è nato un ordine in contanti per una casa a 11 km').toHaveLength(0);
      expect(chiamateRpc, 'il rifiuto per zona ha già riservato la merce').not.toContain('reserve_stock');
    });

    it(
      `tutto il giro, una casa ogni 7,5 gradi presa dalla ${fonte}: a ${DENTRO_KM} km l'ordine nasce, a ${FUORI_KM} km no`,
      async () => {
        const sbagliate: string[] = [];
        for (const gradi of GIRO) {
          for (const distanza of [DENTRO_KM, FUORI_KM]) {
            ordiniCreati.length = 0;
            chiamateRpc.length = 0;
            const { res, corpo } = await paga(puntoA(distanza, gradi), fonte);
            const perZona = corpo.error?.message === motivoFuoriZona(NEGOZIO.nome);
            const giusta =
              distanza < RAGGIO_CONSEGNA_KM
                ? !perZona && ordiniCreati.length === 1
                : res.status === 400 && perZona && ordiniCreati.length === 0 && !chiamateRpc.includes('reserve_stock');
            if (!giusta) {
              sbagliate.push(`${distanza} km verso ${gradi}°: risposta ${res.status}, ordini nati ${ordiniCreati.length}`);
            }
          }
        }
        expect(sbagliate, 'la cassa in contanti sbaglia il confine in queste direzioni').toEqual([]);
      },
      60_000,
    );
  }
});
