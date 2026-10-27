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
];
const FONTI: Fonte[] = ['rubrica', 'geocodifica'];

const fonti: Record<Fonte, Coord | null> = { rubrica: null, geocodifica: null };
const ordiniCreati: Array<Record<string, unknown>> = [];
const chiamateRpc: string[] = [];

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
    if (tavola === 'products') return catena({ data: prodotti, error: null });
    if (tavola === 'seller_public_profiles') return catena({ data: venditori, error: null });
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
function ordina(): never {
  return new Request('http://localhost/api/orders/cod', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      groups: [{ sellerId: NEGOZIO_ID, items: [{ productId: PRODOTTO, quantity: 1 }] }],
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

async function paga(casa: Coord, fonte: Fonte) {
  fonti.rubrica = fonte === 'rubrica' ? casa : null;
  fonti.geocodifica = fonte === 'geocodifica' ? casa : null;
  const { POST } = await import('@/app/api/orders/cod/route');
  const res = await (POST as unknown as (req: never) => Promise<Response>)(ordina());
  const corpo = (await res.json()) as { error?: { message?: string } };
  return { res, corpo };
}

beforeEach(() => {
  ordiniCreati.length = 0;
  chiamateRpc.length = 0;
  fonti.rubrica = null;
  fonti.geocodifica = null;
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
