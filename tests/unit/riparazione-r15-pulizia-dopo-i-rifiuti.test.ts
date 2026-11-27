import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * La pulizia dei tentativi abbandonati chiude su Stripe le casse degli altri carrelli che hanno
 * un prodotto in comune. Deve girare solo quando la richiesta ha passato i rifiuti: un tentativo
 * respinto (negozio chiuso nella fascia, fascia finita) non deve uccidere una cassa ancora buona.
 *
 * Il caso della voce (un carrello B a negozio chiuso, mentre la cassa del carrello A è aperta) e il
 * caso del ramo del riuso: B ha già una riga aperta identica, ma la sua pagina su Stripe è scaduta,
 * quindi non c'è niente da restituire, e la richiesta viene poi respinta per la fascia.
 *
 * ⚪ Non tocca il database né Stripe: tutti e due sono finti. L'orologio è finto.
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
const MERCOLEDI_12_30 = new Date('2026-11-25T11:30:00Z'); // 12:30 a Roma

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
    if (tavola === 'orders') return fisso({ data: [], error: null });
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

async function paga(fascia: string, quante = 1): Promise<{ stato: number; messaggio: string }> {
  const { POST } = await import('@/app/api/stripe/checkout/route');
  const res = await (POST as unknown as (req: never) => Promise<Response>)(
    new Request('http://localhost/api/stripe/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        groups: [{ sellerId: NEGOZIO, items: [{ productId: PRODOTTO, quantity: quante }], shippingCents: 0 }],
        delivery: { fullName: 'Maria Rossi', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', phone: '3331234567' },
        pickupInStore: false,
        deliverySlot: fascia,
      }),
    }) as never,
  );
  const corpo = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  return { stato: res.status, messaggio: corpo.error?.message ?? '' };
}

/** Una cassa viva su un altro carrello (A) con lo stesso prodotto: due torte, pagina aperta. */
function cassaVivaDelCarrelloA(): RigaIntento {
  const riga: RigaIntento = {
    id: 'pc_A',
    buyer_id: 'maria',
    status: 'PENDING',
    groups: [{ items: [{ productId: PRODOTTO, quantity: 2, variantId: null }] }],
    coupon_code: null,
    stripe_session_id: 'cs_A',
    delivery: { impronta_carrello: 'carrello-A' },
    expires_at: new Date(Date.now() + 2 * 3600_000).toISOString(),
    created_at: new Date(Date.now() - 3600_000).toISOString(),
  };
  db.intenti.push(riga);
  return riga;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(MERCOLEDI_10);
  db.scorte = 10;
  db.intenti.length = 0;
  db.sessioniChiuse.length = 0;
  db.sessioniCreate.length = 0;
  db.sessioniScadute.clear();
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://mycity.test');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('la pulizia non chiude una cassa buona per un tentativo poi respinto', () => {
  it('IL CASO DELLA VOCE: il carrello B a negozio chiuso prende 409 e la cassa del carrello A resta aperta', async () => {
    const a = cassaVivaDelCarrelloA();

    // Domani è giovedì: il forno è chiuso.
    const b = await paga('Domani · 9:00–11:00');
    expect(b.stato).toBe(409);
    expect(b.messaggio).toContain('è chiuso');

    expect(db.sessioniChiuse, 'il tentativo respinto ha chiuso su Stripe la cassa del carrello A').toEqual([]);
    expect(a.status).toBe('PENDING');
  });

  it('IL RAMO DEL RIUSO: la pagina identica è scaduta, la fascia è finita: 409 e la cassa A resta aperta', async () => {
    // Alle 10:00 B apre la sua pagina per «Oggi · 11:00–13:00».
    const primo = await paga('Oggi · 11:00–13:00');
    expect(primo.stato).toBe(200);
    const [paginaDiB] = db.sessioniCreate;

    // Poi una cassa viva sullo stesso prodotto (carrello A), e la pagina di B scade su Stripe.
    const a = cassaVivaDelCarrelloA();
    db.sessioniScadute.add(paginaDiB);

    // Alle 12:30 B ripreme con lo stesso carrello: la fascia finisce fra mezz'ora.
    vi.setSystemTime(MERCOLEDI_12_30);
    const secondo = await paga('Oggi · 11:00–13:00');
    expect(secondo.stato).toBe(409);
    expect(secondo.messaggio).toContain('meno di un’ora');

    expect(db.sessioniChiuse, 'il tentativo respinto ha chiuso su Stripe la cassa del carrello A').toEqual([]);
    expect(a.status).toBe('PENDING');
  });

  it('una richiesta che passa i controlli fa ancora la pulizia, anche dal ramo del riuso', async () => {
    const primo = await paga('Oggi · 16:30–18:00');
    expect(primo.stato).toBe(200);
    const [paginaDiB] = db.sessioniCreate;

    const a = cassaVivaDelCarrelloA();
    db.sessioniScadute.add(paginaDiB);

    // Stesso carrello, fascia ancora buona: la pagina vecchia non si restituisce, se ne apre una nuova.
    const secondo = await paga('Oggi · 16:30–18:00');
    expect(secondo.stato).toBe(200);
    expect(db.sessioniChiuse, 'la cassa abbandonata del carrello A non è stata chiusa').toEqual(['cs_A']);
    expect(a.status).not.toBe('PENDING');
    expect(db.sessioniCreate).toHaveLength(2);
  });
});
