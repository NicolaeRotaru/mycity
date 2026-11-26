import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * La regola decisa (consegna.capienza, 1/11): al massimo 5 ordini per fascia. La rotta della carta
 * accettava carrelli senza limite nella stessa fascia: nessuno contava. Adesso conta i giri non
 * annullati nella stessa fascia e nello stesso giorno (un carrello con più negozi vale un giro) e al
 * sesto risponde 409 «fascia piena», prima di aprire la pagina di Stripe.
 *
 * ⚪ Non tocca il database né Stripe: tutti e due sono finti. L'orologio è finto (mercoledì 10:00).
 */

const NEGOZIO = 'aaaaaaaa-0000-0000-0000-000000000001';
const PRODOTTO = '11111111-1111-1111-1111-111111111111';

// Mercoledì aperto, giovedì chiuso.
const ORARI = {
  mon: [['09:00', '19:30']],
  tue: [['09:00', '19:30']],
  wed: [['09:00', '19:30']],
  thu: [],
  fri: [['09:00', '19:30']],
  sat: [['09:00', '19:30']],
  sun: [],
};
const MERCOLEDI_10 = new Date('2026-11-25T09:00:00Z'); // 10:00 a Roma

type RigaOrdine = {
  id: string;
  user_id: string | null;
  delivery_slot: string | null;
  created_at: string;
  pickup_in_store?: boolean;
  delivery_status?: string;
};

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
  sessioniScadute: new Set<string>(),
  ordini: [] as RigaOrdine[],
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
        retrieve: async (id: string) => ({
          id,
          status: db.sessioniScadute.has(id) ? 'expired' : 'open',
          url: db.sessioniScadute.has(id) ? null : `https://stripe.test/${id}`,
        }),
        expire: async (id: string) => {
          db.sessioniChiuse.push(id);
          return { id, status: 'expired' };
        },
      },
    },
  }),
}));
vi.mock('@/lib/shipping-coordinate', () => ({ coordinateDaIndirizziSalvati: vi.fn(async () => null) }));
vi.mock('@/lib/geocodifica', () => ({ coordinateDiUnIndirizzo: vi.fn(async () => null) }));
vi.mock('@/lib/promotions', () => ({
  fetchActiveDiscounts: vi.fn(async () => new Map()),
  discountedUnitCents: vi.fn((prezzo: number) => Math.round(prezzo * 100)),
}));

vi.mock('@/lib/supabase/server', () => {
  const prodotti = () => [
    { id: PRODOTTO, seller_id: NEGOZIO, name: 'Torta', price: 20, stock: db.scorte, has_variants: false, images: [], status: 'available' },
  ];
  const venditori = [{ id: NEGOZIO, store_name: 'Pane Quotidiano', store_lat: 45.05, store_lng: 9.69, store_hours: ORARI }];

  const fisso = (valore: unknown) => {
    const b: Record<string, unknown> = {
      select: () => b, eq: () => b, in: () => b, gt: () => b, is: () => b, filter: () => b, order: () => b, limit: () => b,
      single: () => Promise.resolve(valore), maybeSingle: () => Promise.resolve(valore),
      then: (res: (v: unknown) => unknown) => Promise.resolve(valore).then(res),
    };
    return b;
  };

  // Gli ordini: si applicano i filtri che la rotta chiede (fasce e da quando), come il database.
  const tabellaOrdini = () => {
    let colonne = '';
    let fasce: string[] | null = null;
    let da: string | null = null;
    const b: Record<string, unknown> = {
      select: (c: string) => { colonne = c; return b; },
      in: (col: string, v: string[]) => { if (col === 'delivery_slot') fasce = v; return b; },
      gte: (col: string, v: string) => { if (col === 'created_at') da = v; return b; },
      eq: () => b, neq: () => b, is: () => b, order: () => b, limit: () => b,
      then: (res: (v: unknown) => unknown) => {
        if (!colonne.includes('delivery_slot')) return Promise.resolve({ data: [], error: null }).then(res);
        const righe = db.ordini.filter(
          (o) => (fasce === null || fasce.includes(String(o.delivery_slot))) && (da === null || o.created_at >= da),
        );
        return Promise.resolve({ data: righe, error: null, count: righe.length }).then(res);
      },
    };
    return b;
  };

  const tabellaIntenti = () => ({
    select: () => {
      const filtri: Record<string, unknown> = {};
      const b: Record<string, unknown> = {
        eq: (col: string, v: unknown) => { filtri[col] = v; return b; },
        in: () => b,
        gt: () => b,
        filter: (col: string, _op: string, v: unknown) => { filtri[col] = v; return b; },
        order: () => b,
        limit: () => b,
        maybeSingle: () => {
          const trovato = [...db.intenti].reverse().find(
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
            // Nata da un'ora: non è una cassa «che sta nascendo».
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
    if (tavola === 'orders') return tabellaOrdini();
    if (tavola === 'consent_log') return { update: () => ({ is: () => ({ in: () => Promise.resolve({ error: null }) }) }) };
    return fisso({ data: [], error: null });
  };

  const rpc = (nome: string, args: Record<string, unknown>) => {
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

const FASCIA = 'Oggi · 16:30–18:00';
const OGGI_ALLE_9 = '2026-11-25T08:00:00.000Z'; // mercoledì 9:00 a Roma
const IERI_ALLE_18 = '2026-11-24T17:00:00.000Z'; // martedì 18:00 a Roma

function ordine(id: string, cliente: string | null, fascia: string, creatoIl = OGGI_ALLE_9, altro: Partial<RigaOrdine> = {}): RigaOrdine {
  return { id, user_id: cliente, delivery_slot: fascia, created_at: creatoIl, pickup_in_store: false, delivery_status: 'NEW', ...altro };
}

/** `quanti` clienti diversi (non la persona che compra), un ordine ciascuno, nella fascia di oggi. */
function altriClienti(quanti: number): RigaOrdine[] {
  return Array.from({ length: quanti }, (_, i) => ordine(`o_${i + 1}`, `cliente-${i + 1}`, FASCIA));
}

async function paga(fascia = FASCIA): Promise<{ stato: number; messaggio: string }> {
  const { POST } = await import('@/app/api/stripe/checkout/route');
  const res = await (POST as unknown as (req: never) => Promise<Response>)(
    new Request('http://localhost/api/stripe/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        groups: [{ sellerId: NEGOZIO, items: [{ productId: PRODOTTO, quantity: 1 }], shippingCents: 0 }],
        delivery: { fullName: 'Maria Rossi', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', phone: '3331234567' },
        pickupInStore: false,
        deliverySlot: fascia,
      }),
    }) as never,
  );
  const corpo = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  return { stato: res.status, messaggio: corpo.error?.message ?? '' };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(MERCOLEDI_10);
  db.scorte = 10;
  db.intenti.length = 0;
  db.sessioniChiuse.length = 0;
  db.sessioniCreate.length = 0;
  db.sessioniScadute.clear();
  db.ordini = [];
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://mycity.test');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('al massimo 5 giri per fascia', () => {
  it('IL CASO: cinque clienti già nella fascia, il sesto prende 409 «fascia piena» e nessuna pagina si apre', async () => {
    db.ordini = altriClienti(5);
    const r = await paga();
    expect(r.stato).toBe(409);
    expect(r.messaggio).toContain('piena');
    expect(db.sessioniCreate).toEqual([]);
  });

  it('con quattro giri il quinto passa', async () => {
    db.ordini = altriClienti(4);
    const r = await paga();
    expect(r.stato).toBe(200);
    expect(db.sessioniCreate).toHaveLength(1);
  });

  it('annullati, ritiri, un’altra fascia e la stessa fascia di ieri non contano', async () => {
    db.ordini = [
      ...altriClienti(4),
      ordine('x_annullato', 'cliente-a', FASCIA, OGGI_ALLE_9, { delivery_status: 'CANCELED' }),
      ordine('x_ritiro', 'cliente-b', FASCIA, OGGI_ALLE_9, { pickup_in_store: true }),
      ordine('x_altra', 'cliente-c', 'Oggi · 18:00–19:30'),
      ordine('x_ieri', 'cliente-d', FASCIA, IERI_ALLE_18),
    ];
    expect((await paga()).stato).toBe(200);
  });

  it('«Domani · 16:30–18:00» scelto ieri è la stessa fascia di oggi, e conta', async () => {
    db.ordini = [...altriClienti(4), ordine('x_domani', 'cliente-d', 'Domani · 16:30–18:00', IERI_ALLE_18)];
    const r = await paga();
    expect(r.stato).toBe(409);
    expect(r.messaggio).toContain('piena');
  });

  it('un carrello con due negozi è un giro solo', async () => {
    db.ordini = [...altriClienti(4), ordine('o_4b', 'cliente-4', FASCIA)];
    expect((await paga()).stato).toBe(200);
  });

  it('chi ha già un giro nella fascia aggiunge un carrello alla stessa porta', async () => {
    db.ordini = [...altriClienti(4), ordine('o_mio', 'maria', FASCIA)];
    expect((await paga()).stato).toBe(200);
  });

  it('la fascia piena è un rifiuto come gli altri: non chiude la cassa aperta di un altro carrello', async () => {
    db.intenti.push({
      id: 'pc_A', buyer_id: 'maria', status: 'PENDING',
      groups: [{ items: [{ productId: PRODOTTO, quantity: 2, variantId: null }] }],
      coupon_code: null, stripe_session_id: 'cs_A', delivery: { impronta_carrello: 'carrello-A' },
      expires_at: new Date(Date.now() + 2 * 3600_000).toISOString(),
      created_at: new Date(Date.now() - 3600_000).toISOString(),
    });
    db.ordini = altriClienti(5);
    expect((await paga()).stato).toBe(409);
    expect(db.sessioniChiuse).toEqual([]);
  });
});
