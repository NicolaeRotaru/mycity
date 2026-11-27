import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MOTIVO_FASCIA_PIENA, ORDINI_PER_FASCIA } from '@/lib/quando-arriva';

/**
 * Il riuso della pagina di Stripe rifà i controlli della fascia e il tetto dei giri.
 *
 * Mercoledì 25/11, 15:00 di Roma: il cliente apre la cassa con «Oggi · 16:30–18:00» e torna
 * indietro. Alle 17:35 rimanda lo stesso carrello: una richiesta nuova prenderebbe 409 (a meno di
 * un'ora dalla fine), la rotta restituiva la pagina vecchia. Stessa cosa con la fascia piena.
 * Supabase e Stripe finti (le finte vengono dalla prova del riuso della stessa rotta), orologio finto.
 */

const P1 = '11111111-1111-1111-1111-111111111111';
const S1 = 'aaaaaaaa-0000-0000-0000-000000000001';

/** Le righe di intento scritte davvero. */
const intenti: Array<{ id: string; buyer_id: string; status: string; delivery: Record<string, unknown>; stripe_session_id: string | null; expires_at: string }> = [];
const rpcChiamate: string[] = [];
const sessioniCreate: string[] = [];
const ordiniNellaFascia: Array<Record<string, unknown>> = [];

// 31/10/2026 — Al lancio la carta è spenta (CARTA_ACCESA in lib/funzioni-al-lancio.ts) e la rotta
// la rifiuta anche con le chiavi. Questa prova misura il percorso della carta: la accende per finta.
vi.mock('@/lib/funzioni-al-lancio', async (originale) => ({
  ...((await originale()) as Record<string, unknown>),
  CARTA_ACCESA: true,
  CODICI_SCONTO_IN_CASSA: true,
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit: (
    _opts: unknown,
    h: (ctx: { user: { id: string; email: string; email_confirmed_at: string }; profile: unknown; req: Request }) => unknown,
  ) => (req: Request) => h({
    user: { id: 'cliente-1', email: 'cliente@test.it', email_confirmed_at: '2026-01-01T00:00:00Z' },
    profile: { role: 'buyer', is_approved: true },
    req,
  }),
  assertCanPurchase: vi.fn(() => null),
}));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  createMultiSellerCheckoutSession: vi.fn(async () => {
    const id = `cs_${sessioniCreate.length + 1}`;
    sessioniCreate.push(id);
    return { id, url: `https://stripe.test/${id}` };
  }),
  // La sessione di prima e' ancora apribile: e' il caso di chi torna indietro.
  getStripe: () => ({
    checkout: {
      sessions: {
        retrieve: async (id: string) => ({ id, status: 'open', url: `https://stripe.test/${id}` }),
      },
    },
  }),
}));
vi.mock('@/lib/coupons', () => ({
  validateCoupon: vi.fn(async () => ({ ok: true, discount: 2, freeShipping: false, coupon: { code: 'SCONTO2' } })),
}));
vi.mock('@/lib/shipping', () => ({ shippingCentsFor: vi.fn(() => 490), compensoRiderCents: vi.fn(() => 300) }));
vi.mock('@/lib/shipping-coordinate', () => ({ coordinateDaIndirizziSalvati: vi.fn(async () => null) }));
vi.mock('@/lib/geocodifica', () => ({ coordinateDiUnIndirizzo: vi.fn(async () => null) }));
// 3/9/2026 — la rotta adesso decide con `negozioPuoServire`, che guarda la fascia
// scelta e non solo l'orologio (l'ordine serale per domani non si rifiuta piu').
vi.mock('@/lib/store-hours', async (originale) => ({
  ...((await originale()) as Record<string, unknown>),
  negozioPuoServire: vi.fn(() => true),
  motivoNegozioChiuso: vi.fn((n: string) => `${n} è chiuso in questo momento.`),
}));
vi.mock('@/lib/promotions', () => ({
  fetchActiveDiscounts: vi.fn(async () => new Map()),
  discountedUnitCents: vi.fn((prezzo: number) => Math.round(prezzo * 100)),
}));

vi.mock('@/lib/supabase/server', () => {
  const prodotti = [
    { id: P1, seller_id: S1, name: 'Pane', price: 10, stock: 10, has_variants: false, images: [], status: 'available' },
  ];
  const venditori = [{ id: S1, store_name: 'Forno', store_lat: 45.05, store_lng: 9.69, store_hours: null }];

  const letture = (table: string) => ({
    select: () => ({
      in: () => Promise.resolve({
        data: table === 'products' ? prodotti : table === 'product_variants' ? [] : venditori,
        error: null,
      }),
      eq: () => Promise.resolve({ data: [], error: null }),
    }),
  });

  /** La tabella degli intenti, con il filtro sull'impronta del carrello. */
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
          const trovato = intenti.find((r) =>
            r.buyer_id === filtri.buyer_id &&
            r.status === (filtri.status ?? r.status) &&
            r.delivery.impronta_carrello === filtri['delivery->>impronta_carrello']);
          return Promise.resolve({ data: trovato ?? null, error: null });
        },
      };
      return b;
    },
    insert: (riga: Record<string, unknown>) => ({
      select: () => ({
        single: () => {
          const id = `pc_${intenti.length + 1}`;
          intenti.push({
            id,
            buyer_id: riga.buyer_id as string,
            status: (riga.status as string) ?? 'PENDING',
            delivery: riga.delivery as Record<string, unknown>,
            stripe_session_id: null,
            expires_at: new Date(Date.now() + 2 * 3600_000).toISOString(),
          });
          return Promise.resolve({ data: { id, expires_at: intenti[intenti.length - 1].expires_at }, error: null });
        },
      }),
    }),
    update: (valori: Record<string, unknown>) => ({
      eq: (_c: string, id: string) => {
        const riga = intenti.find((r) => r.id === id);
        if (riga && typeof valori.stripe_session_id === 'string') riga.stripe_session_id = valori.stripe_session_id;
        if (riga && typeof valori.status === 'string') riga.status = valori.status as string;
        return Promise.resolve({ error: null });
      },
    }),
  });

  const adminFrom = (table: string): Record<string, unknown> => {
    if (table === 'pending_checkouts') return tabellaIntenti() as unknown as Record<string, unknown>;
    if (table === 'consent_log') return { update: () => ({ is: () => ({ in: () => Promise.resolve({ error: null }) }) }) };
    if (table === 'user_addresses') return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) };
    // Gli ordini già nella fascia: li legge il conteggio dei giri.
    if (table === 'orders') {
      return {
        select: () => ({
          in: () => ({ gte: () => Promise.resolve({ data: ordiniNellaFascia, error: null, count: ordiniNellaFascia.length }) }),
        }),
        insert: () => Promise.resolve({ error: null }),
      };
    }
    return { insert: () => Promise.resolve({ error: null }) };
  };

  const rpc = (nome: string) => {
    rpcChiamate.push(nome);
    if (nome === 'claim_coupon') return Promise.resolve({ data: true, error: null });
    return Promise.resolve({ data: null, error: null });
  };

  return {
    getServerSupabase: async () => ({ from: letture, rpc }),
    getAdminSupabase: () => ({ from: adminFrom, rpc }),
  };
});

const FASCIA = 'Oggi · 16:30–18:00';
const carrello = {
  groups: [{ sellerId: S1, items: [{ productId: P1, quantity: 1 }], shippingCents: 0 }],
  delivery: { fullName: 'Maria Rossi', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', phone: '3331234567' },
  couponCode: 'SCONTO2',
  pickupInStore: false,
  deliverySlot: FASCIA,
};

async function paga(corpo: unknown = carrello) {
  const { POST } = await import('@/app/api/stripe/checkout/route');
  const req = new Request('http://localhost/api/stripe/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  const res = await (POST as unknown as (r: Request) => Promise<Response>)(req);
  return { stato: res.status, corpo: await res.json() };
}

beforeEach(() => {
  intenti.length = 0;
  rpcChiamate.length = 0;
  sessioniCreate.length = 0;
  ordiniNellaFascia.length = 0;
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://mycity.test');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-25T14:00:00Z')); // 15:00 a Roma
});
afterEach(() => { vi.useRealTimers(); });

describe('la pagina già aperta non scavalca i rifiuti della fascia', () => {
  it('stesso carrello, nessun cambio: la pagina si riprende ancora', async () => {
    const primo = await paga();
    expect(primo.stato).toBe(200);
    const secondo = await paga();
    expect(secondo.stato).toBe(200);
    expect(secondo.corpo.data.url).toBe(primo.corpo.data.url);
  });

  it('alle 17:35 la fascia che finisce alle 18 è rifiutata anche al riuso', async () => {
    expect((await paga()).stato).toBe(200);
    vi.setSystemTime(new Date('2026-11-25T16:35:00Z')); // 17:35 a Roma
    const secondo = await paga();
    expect(secondo.stato, 'la pagina vecchia è stata restituita: al pagamento il webhook rimborsa').toBe(409);
    expect(sessioniCreate.length).toBe(1);
  });

  it('la fascia riempita da altri clienti nel frattempo: 409 del tetto anche al riuso', async () => {
    expect((await paga()).stato).toBe(200);
    for (let i = 0; i < ORDINI_PER_FASCIA; i++) {
      ordiniNellaFascia.push({
        id: `o${i}`, user_id: `altro-${i}`, delivery_slot: FASCIA, created_at: '2026-11-25T13:00:00Z',
        pickup_in_store: false, delivery_status: 'PENDING',
      });
    }
    const secondo = await paga();
    expect(secondo.stato, 'il tetto dei giri è stato saltato dalla pagina vecchia').toBe(409);
    expect(JSON.stringify(secondo.corpo)).toContain(MOTIVO_FASCIA_PIENA.slice(0, 30));
  });
});
