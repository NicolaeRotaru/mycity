import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fuoriZonaDiConsegna, motivoFuoriZona } from '@/lib/ordini/zona-di-consegna';
import { shippingForEuro } from '@/lib/shipping';
import { FREE_SHIPPING_THRESHOLD, RAGGIO_CONSEGNA_KM } from '@/lib/constants';

/**
 * 6/9/2026 — IL SITO ACCETTAVA UNA CONSEGNA A MILANO E NON CHIEDEVA UN
 * CENTESIMO DI SPEDIZIONE.
 *
 * Non esisteva nessun controllo della zona di consegna, in nessun punto del
 * progetto: il perimetro «Piacenza e dintorni» viveva solo nei testi del sito.
 * Lo schema della cassa accetta qualunque CAP, e il conto della spedizione
 * azzerava il prezzo appena il carrello superava i 30 € — PRIMA di guardare la
 * distanza. Negozio a Piacenza, consegna a Milano, 60 km, carrello da 35 €:
 * spedizione 0,00 e ordine confermato.
 *
 * Cosa succedeva dopo: la persona riceveva l'email di conferma, e poi qualcuno
 * doveva telefonarle e annullare. Un rimborso, una recensione arrabbiata, un
 * negoziante che aveva già preparato la merce. Sul lato soldi: 60 km di
 * consegna coperti da 3 € di fee, che è quanto prende il fattorino.
 *
 * ⚪ Il raggio (20 km) è una decisione commerciale: qui si prova il MECCANISMO,
 * non il numero — le prove usano `RAGGIO_CONSEGNA_KM`, quindi cambiarlo non
 * fa diventare rossa nessuna di queste righe.
 */

const NEGOZIO_PIACENZA = { lat: 45.0526, lng: 9.6929 };
const CASA_A_PIACENZA = { lat: 45.0701, lng: 9.712 };   // ~2,4 km
const CASA_A_MILANO = { lat: 45.4642, lng: 9.19 };      // ~60 km

describe('la zona di consegna', () => {
  it('un indirizzo in città è dentro', () => {
    expect(
      fuoriZonaDiConsegna({
        storeLat: NEGOZIO_PIACENZA.lat,
        storeLng: NEGOZIO_PIACENZA.lng,
        deliveryLat: CASA_A_PIACENZA.lat,
        deliveryLng: CASA_A_PIACENZA.lng,
      }),
    ).toBe(false);
  });

  it('IL CASO CHE ROMPEVA — Milano è fuori', () => {
    expect(
      fuoriZonaDiConsegna({
        storeLat: NEGOZIO_PIACENZA.lat,
        storeLng: NEGOZIO_PIACENZA.lng,
        deliveryLat: CASA_A_MILANO.lat,
        deliveryLng: CASA_A_MILANO.lng,
      }),
      `una consegna a 60 km risulta ancora dentro la zona (raggio dichiarato: ${RAGGIO_CONSEGNA_KM} km)`,
    ).toBe(true);
  });

  it('senza coordinate non blocca nessuno: un dato mancante non è un rifiuto', () => {
    expect(
      fuoriZonaDiConsegna({
        storeLat: null,
        storeLng: null,
        deliveryLat: CASA_A_MILANO.lat,
        deliveryLng: CASA_A_MILANO.lng,
      }),
      'un negozio senza posizione sulla vetrina non deve poter rifiutare i suoi clienti',
    ).toBe(false);
    expect(
      fuoriZonaDiConsegna({
        storeLat: NEGOZIO_PIACENZA.lat,
        storeLng: NEGOZIO_PIACENZA.lng,
        deliveryLat: null,
        deliveryLng: null,
      }),
    ).toBe(false);
  });

  it('col ritiro in negozio non c è consegna, quindi non c è zona', () => {
    expect(
      fuoriZonaDiConsegna({
        storeLat: NEGOZIO_PIACENZA.lat,
        storeLng: NEGOZIO_PIACENZA.lng,
        deliveryLat: CASA_A_MILANO.lat,
        deliveryLng: CASA_A_MILANO.lng,
        pickupInStore: true,
      }),
    ).toBe(false);
  });

  it('il messaggio è un offerta, e non promette il ritiro in negozio finché è spento', () => {
    const detto = motivoFuoriZona('Pane Quotidiano');
    expect(detto).toContain('Piacenza e dintorni');
    expect(detto).toContain('Pane Quotidiano');
    expect(detto, 'manda in negozio a ritirare mentre la cassa non lo permette').not.toContain('Puoi ritirare in negozio');
  });
});

describe('la spedizione gratis sopra la soglia', () => {
  it('vale in città, come sempre', () => {
    expect(
      shippingForEuro({
        subtotal: FREE_SHIPPING_THRESHOLD + 5,
        storeLat: NEGOZIO_PIACENZA.lat,
        storeLng: NEGOZIO_PIACENZA.lng,
        deliveryLat: CASA_A_PIACENZA.lat,
        deliveryLng: CASA_A_PIACENZA.lng,
        pickupInStore: false,
      }),
    ).toBe(0);
  });

  it('IL CASO CHE ROMPEVA — non azzera più una consegna fuori zona', () => {
    const costo = shippingForEuro({
      subtotal: FREE_SHIPPING_THRESHOLD + 5,
      storeLat: NEGOZIO_PIACENZA.lat,
      storeLng: NEGOZIO_PIACENZA.lng,
      deliveryLat: CASA_A_MILANO.lat,
      deliveryLng: CASA_A_MILANO.lng,
      pickupInStore: false,
    });
    expect(costo, 'il carrello scriveva «Gratis» su 60 km di consegna che non faremo mai').toBeGreaterThan(0);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
 * E ADESSO LA CASSA VERA: l'ordine a Milano non deve nascere.
 * ────────────────────────────────────────────────────────────────────────────*/

const NEGOZIO = 'aaaaaaaa-0000-0000-0000-000000000001';
const PRODOTTO = '11111111-1111-1111-1111-111111111111';
const chiamateRpc: string[] = [];
const ordiniCreati: unknown[] = [];

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
vi.mock('@/lib/coupons', () => ({ validateCoupon: vi.fn(async () => ({ ok: true, discount: 5, freeShipping: false, coupon: { code: 'PRIMI50' } })) }));
// L'indirizzo scritto è uno di quelli salvati dalla persona: le coordinate
// arrivano dal database, come in produzione.
vi.mock('@/lib/shipping-coordinate', () => ({
  coordinateDaIndirizziSalvati: vi.fn(async () => ({ lat: 45.4642, lng: 9.19 })),
}));
vi.mock('@/lib/geocodifica', () => ({ coordinateDiUnIndirizzo: vi.fn(async () => null) }));

vi.mock('@/lib/supabase/server', () => {
  const prodotti = [
    { id: PRODOTTO, seller_id: NEGOZIO, name: 'Pane', price: 35, stock: 10, has_variants: false, images: [], status: 'available' },
  ];
  const venditori = [
    { id: NEGOZIO, store_name: 'Pane Quotidiano', store_lat: 45.0526, store_lng: 9.6929, store_hours: null },
  ];
  const risolvibile = (valore: unknown) => {
    const b: Record<string, unknown> = {
      select: () => b, eq: () => b, in: () => b, limit: () => b,
      single: () => Promise.resolve(valore), maybeSingle: () => Promise.resolve(valore),
      then: (res: (v: unknown) => unknown) => res(valore),
    };
    return b;
  };
  const from = (tavola: string): Record<string, unknown> => {
    if (tavola === 'products') return risolvibile({ data: prodotti, error: null });
    if (tavola === 'seller_public_profiles') return risolvibile({ data: venditori, error: null });
    if (tavola === 'product_variants') return risolvibile({ data: [], error: null });
    if (tavola === 'orders') {
      return {
        insert: (v: unknown) => {
          ordiniCreati.push(v);
          return { select: () => ({ single: () => Promise.resolve({ data: { id: 'ord-1' }, error: null }) }) };
        },
        select: () => risolvibile({ data: [], error: null }),
        delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    }
    return risolvibile({ data: [], error: null });
  };
  return {
    getAdminSupabase: () => ({
      from,
      rpc: (nome: string) => { chiamateRpc.push(nome); return Promise.resolve({ data: null, error: null }); },
      auth: { admin: { getUserById: async () => ({ data: { user: { email: 'negozio@test.it' } } }) } },
    }),
    getServerSupabase: async () => ({ from }),
  };
});

function ordinaAMilano(): never {
  return new Request('http://localhost/api/orders/cod', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      groups: [{ sellerId: NEGOZIO, items: [{ productId: PRODOTTO, quantity: 1 }] }],
      delivery: { fullName: 'Maria Rossi', address: 'Corso Buenos Aires 1', city: 'Milano', zip: '20124', phone: '3331234567' },
      couponCode: 'PRIMI50',
      pickupInStore: false,
      useCredit: false,
    }),
  }) as never;
}

beforeEach(() => {
  chiamateRpc.length = 0;
  ordiniCreati.length = 0;
});

describe('la cassa in contanti, con un indirizzo fuori zona', () => {
  it('IL CASO CHE ROMPEVA — non crea l ordine e lo dice in italiano', async () => {
    const { POST } = await import('@/app/api/orders/cod/route');
    const res = await (POST as unknown as (req: never) => Promise<Response>)(ordinaAMilano());
    const corpo = (await res.json()) as { ok: boolean; error: { message: string } };

    expect(res.status, 'l ordine per Milano è ancora passato').toBe(400);
    expect(ordiniCreati, 'è nato un ordine che nessuno può consegnare').toHaveLength(0);
    expect(corpo.error.message).toContain('Piacenza e dintorni');
    expect(corpo.error.message, 'il messaggio non nomina il negozio').toContain('Pane Quotidiano');
  });

  it('e non brucia il codice sconto di chi ci ha provato', async () => {
    const { POST } = await import('@/app/api/orders/cod/route');
    await (POST as unknown as (req: never) => Promise<Response>)(ordinaAMilano());

    expect(
      chiamateRpc.filter((n) => n === 'claim_coupon'),
      'il rifiuto per zona ha consumato un uso del buono: il cliente lo perde senza aver comprato niente',
    ).toHaveLength(0);
  });
});
