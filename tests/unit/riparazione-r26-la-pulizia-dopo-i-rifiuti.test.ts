import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FASCE_DI_DOMANI } from '@/lib/quando-arriva';

/**
 * R26-021 — La pulizia girava prima di ogni convalida del carrello: un
 * tentativo respinto uccideva una cassa ancora buona.
 *
 * La pulizia dei tentativi abbandonati chiude su Stripe le pagine di pagamento
 * degli altri carrelli che condividono un prodotto. Girava come primo movimento
 * della rotta della carta: un secondo tentativo poi RESPINTO (prodotto non
 * vendibile, negozio chiuso, fascia chiusa, fuori zona) aveva gia' chiuso la
 * pagina del primo, ancora buona, e rimesso in vendita la sua merce.
 *
 * Adesso la pulizia parte dopo i rifiuti che non dipendono dalle scorte; le
 * scorte liberate si rileggono prima di contarle.
 *
 * ⚪ Non tocca il database ne' Stripe: tutti e due sono finti.
 */

const NEGOZIO = 'aaaaaaaa-0000-0000-0000-000000000001';
const PRODOTTO = '11111111-1111-1111-1111-111111111111';
const NON_VENDIBILE = '22222222-2222-2222-2222-222222222222';

type RigaIntento = {
  id: string;
  buyer_id: string;
  status: string;
  groups: Array<{ items: Array<{ productId: string; quantity: number; variantId: string | null }> }>;
  coupon_code: string | null;
  stripe_session_id: string | null;
  delivery: Record<string, unknown>;
  expires_at: string;
  created_at: string;
};

const db = {
  scorte: 10,
  intenti: [] as RigaIntento[],
  sessioniChiuse: [] as string[],
  sessioniCreate: [] as string[],
  rpc: [] as string[],
};

vi.mock('@/lib/auth/accettazione-testi', async (o) => ({ ...((await o()) as object), vaChiestaSenzaTrattenere: async () => 'lascia-entrare' }));
vi.mock('@/lib/funzioni-al-lancio', async (originale) => ({
  ...((await originale()) as Record<string, unknown>),
  CARTA_ACCESA: true,
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (_o: unknown, h: (ctx: { user: { id: string; email: string; email_confirmed_at: string }; profile: unknown; req: Request }) => unknown) =>
    (req: Request) =>
      h({
        user: { id: 'maria', email: 'maria@test.it', email_confirmed_at: '2026-01-01T00:00:00Z' },
        profile: { role: 'buyer', is_approved: true },
        req,
      }),
  assertCanPurchase: vi.fn(() => null),
}));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  RiservaTroppoCorta: class RiservaTroppoCorta extends Error {},
  createMultiSellerCheckoutSession: vi.fn(async () => {
    const id = `cs_${db.sessioniCreate.length + 1}`;
    db.sessioniCreate.push(id);
    return { id, url: `https://stripe.test/${id}` };
  }),
  getStripe: () => ({
    checkout: {
      sessions: {
        retrieve: async (id: string) => ({ id, status: 'open', url: `https://stripe.test/${id}` }),
        expire: async (id: string) => { db.sessioniChiuse.push(id); return { id, status: 'expired' }; },
      },
    },
  }),
}));
vi.mock('@/lib/shipping-coordinate', () => ({ coordinateDaIndirizziSalvati: vi.fn(async () => null) }));
vi.mock('@/lib/geocodifica', () => ({ coordinateDiUnIndirizzo: vi.fn(async () => null) }));
vi.mock('@/lib/store-hours', () => ({
  negozioPuoServire: vi.fn(() => true),
  motivoNegozioChiuso: vi.fn((n: string) => `${n} è chiuso.`),
}));
vi.mock('@/lib/promotions', () => ({
  fetchActiveDiscounts: vi.fn(async () => new Map()),
  discountedUnitCents: vi.fn((prezzo: number) => Math.round(prezzo * 100)),
}));

vi.mock('@/lib/supabase/server', () => {
  const prodotti = () => [
    { id: PRODOTTO, seller_id: NEGOZIO, name: 'Torta', price: 20, stock: db.scorte, has_variants: false, images: [], status: 'available' },
    { id: NON_VENDIBILE, seller_id: NEGOZIO, name: 'Pizza', price: 8, stock: 5, has_variants: false, images: [], status: 'hidden' },
  ];
  const venditori = [{ id: NEGOZIO, store_name: 'Pane Quotidiano', store_lat: 45.05, store_lng: 9.69, store_hours: null }];

  const fisso = (valore: unknown) => {
    const b: Record<string, unknown> = {
      select: () => b, eq: () => b, in: () => b, gt: () => b, filter: () => b, order: () => b, limit: () => b,
      single: () => Promise.resolve(valore), maybeSingle: () => Promise.resolve(valore),
      then: (res: (v: unknown) => unknown) => Promise.resolve(valore).then(res),
    };
    return b;
  };

  const tabellaIntenti = () => ({
    select: () => {
      const filtri: Record<string, unknown> = {};
      const b: Record<string, unknown> = {
        eq: (col: string, v: unknown) => { filtri[col] = v; return b; },
        gt: () => b,
        filter: (col: string, _op: string, v: unknown) => { filtri[col] = v; return b; },
        order: () => b,
        limit: () => b,
        maybeSingle: () => {
          const trovato = db.intenti.find(
            (r) =>
              r.buyer_id === filtri.buyer_id &&
              r.status === filtri.status &&
              r.delivery.impronta_carrello === filtri['delivery->>impronta_carrello'],
          );
          return Promise.resolve({ data: trovato ?? null, error: null });
        },
        then: (res: (v: unknown) => unknown) =>
          Promise.resolve({
            data: db.intenti.filter((r) => r.buyer_id === filtri.buyer_id && r.status === filtri.status),
            error: null,
          }).then(res),
      };
      return b;
    },
    insert: (riga: Record<string, unknown>) => ({
      select: () => ({
        single: () => {
          const id = `pc_${db.intenti.length + 1}`;
          db.intenti.push({
            id,
            buyer_id: riga.buyer_id as string,
            status: (riga.status as string) ?? 'PENDING',
            groups: (riga.groups as RigaIntento['groups']) ?? [],
            coupon_code: (riga.coupon_code as string | null) ?? null,
            stripe_session_id: null,
            delivery: riga.delivery as Record<string, unknown>,
            expires_at: new Date(Date.now() + 2 * 3600_000).toISOString(),
            // Nata da un'ora: non e' una cassa «che sta nascendo».
            created_at: new Date(Date.now() - 3600_000).toISOString(),
          });
          const nato = db.intenti[db.intenti.length - 1];
          return Promise.resolve({ data: { id: nato.id, expires_at: nato.expires_at }, error: null });
        },
      }),
    }),
    update: (valori: Record<string, unknown>) => {
      const filtri: Record<string, unknown> = {};
      const applica = () => {
        const riga = db.intenti.find(
          (r) => r.id === filtri.id && (filtri.status === undefined || r.status === filtri.status),
        );
        if (!riga) return { data: [], error: null };
        if (typeof valori.status === 'string') riga.status = valori.status;
        if (typeof valori.stripe_session_id === 'string') riga.stripe_session_id = valori.stripe_session_id;
        if (valori.delivery) riga.delivery = valori.delivery as Record<string, unknown>;
        return { data: [{ id: riga.id }], error: null };
      };
      const b: Record<string, unknown> = {
        eq: (col: string, v: unknown) => { filtri[col] = v; return b; },
        select: () => b,
        then: (res: (v: unknown) => unknown) => Promise.resolve(applica()).then(res),
      };
      return b;
    },
  });

  const letture = (tavola: string) => {
    if (tavola === 'products') {
      // Tornano solo i prodotti chiesti, come in produzione.
      const b: Record<string, unknown> = {
        select: () => b,
        in: (_c: string, ids: string[]) => Promise.resolve({ data: prodotti().filter((p) => ids.includes(p.id)), error: null }),
      };
      return b;
    }
    if (tavola === 'seller_public_profiles') return fisso({ data: venditori, error: null });
    if (tavola === 'product_variants') return fisso({ data: [], error: null });
    return fisso({ data: [], error: null });
  };

  const adminFrom = (tavola: string): Record<string, unknown> => {
    if (tavola === 'pending_checkouts') return tabellaIntenti() as unknown as Record<string, unknown>;
    if (tavola === 'orders') return fisso({ data: [], error: null });
    if (tavola === 'consent_log') return { update: () => ({ is: () => ({ in: () => Promise.resolve({ error: null }) }) }) };
    return fisso({ data: [], error: null });
  };

  const rpc = (nome: string, args: Record<string, unknown>) => {
    db.rpc.push(nome);
    if (nome === 'reserve_stock') {
      const quante = (args.p_items as Array<{ qty: number }>).reduce((s, i) => s + i.qty, 0);
      if (quante > db.scorte) return Promise.resolve({ data: null, error: { message: 'stock insufficiente' } });
      db.scorte -= quante;
      return Promise.resolve({ data: null, error: null });
    }
    if (nome === 'restore_stock') {
      db.scorte += (args.p_items as Array<{ qty: number }>).reduce((s, i) => s + i.qty, 0);
      return Promise.resolve({ data: null, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  };

  return {
    getServerSupabase: async () => ({ from: letture, rpc }),
    getAdminSupabase: () => ({ from: adminFrom, rpc }),
  };
});

type Riga = { productId: string; quantity: number };

async function paga(fascia: string, righe: Riga[] = [{ productId: PRODOTTO, quantity: 1 }]) {
  const { POST } = await import('@/app/api/stripe/checkout/route');
  const res = await (POST as unknown as (req: never) => Promise<Response>)(
    new Request('http://localhost/api/stripe/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        groups: [{ sellerId: NEGOZIO, items: righe, shippingCents: 0 }],
        delivery: { fullName: 'Maria Rossi', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', phone: '3331234567' },
        pickupInStore: false,
        deliverySlot: fascia,
      }),
    }) as never,
  );
  return { stato: res.status };
}

beforeEach(() => {
  db.scorte = 10;
  db.intenti.length = 0;
  db.sessioniChiuse.length = 0;
  db.sessioniCreate.length = 0;
  db.rpc.length = 0;
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://mycity.test');
});

describe('R26-021 — un tentativo respinto non chiude la cassa ancora buona', () => {
  it('un secondo carrello con un prodotto non vendibile viene respinto e la prima pagina resta aperta', async () => {
    const primo = await paga(FASCE_DI_DOMANI[0]);
    expect(primo.stato).toBe(200);
    expect(db.sessioniCreate).toEqual(['cs_1']);
    const scorteDopoIlPrimo = db.scorte;

    // Stessa torta (prodotto in comune) piu' una pizza che non si vende.
    const secondo = await paga(FASCE_DI_DOMANI[0], [
      { productId: PRODOTTO, quantity: 1 },
      { productId: NON_VENDIBILE, quantity: 1 },
    ]);
    expect(secondo.stato).toBe(400);

    expect(db.sessioniChiuse, 'il tentativo respinto ha chiuso la pagina di pagamento buona').toEqual([]);
    expect(db.intenti[0].status, 'il primo tentativo non e piu aperto').toBe('PENDING');
    expect(db.scorte, 'la merce del primo tentativo e tornata in vendita').toBe(scorteDopoIlPrimo);
    expect(db.rpc).not.toContain('restore_stock');
  });

  it('un tentativo che passa i controlli libera ancora il suo vecchio pezzo, e lo vede disponibile', async () => {
    db.scorte = 1;
    const primo = await paga(FASCE_DI_DOMANI[0]);
    expect(primo.stato).toBe(200);
    expect(db.scorte).toBe(0);

    // Cambio la fascia: carrello diverso, stesso unico pezzo che tengo io.
    const secondo = await paga(FASCE_DI_DOMANI[1]);
    expect(secondo.stato, 'il pezzo liberato dalla pulizia risulta ancora esaurito').toBe(200);
    expect(db.sessioniChiuse).toEqual(['cs_1']);
    expect(db.sessioniCreate).toEqual(['cs_1', 'cs_2']);
  });
});
