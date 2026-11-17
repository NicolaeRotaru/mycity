import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fasciaFuoriTempo } from '@/lib/quando-arriva';

/**
 * 30/10/2026 (ondata 22) — LA ROTTA DELLA CARTA FA LA STESSA REGOLA DEI CONTANTI.
 *
 * Collaudo B dell'ondata 21: lunedì alle 17:50 la carta accettava «In giornata · 15:00–18:00»
 * (arriva entro dieci minuti) che i contanti rifiutano con 409; e senza orari del negozio
 * accettava anche una fascia già finita. Adesso le due rotte chiedono a `motivoFasciaRifiutata`:
 * stesso 409, stesso messaggio (quello di `fasciaFuoriTempo`).
 */
const P1 = '11111111-1111-1111-1111-111111111111';
const S1 = 'aaaaaaaa-0000-0000-0000-000000000001';

/** Le righe di intento scritte davvero. */
const intenti: Array<{ id: string; buyer_id: string; status: string; delivery: Record<string, unknown>; stripe_session_id: string | null; expires_at: string }> = [];
const rpcChiamate: string[] = [];
const sessioniCreate: string[] = [];

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
// Niente finto per lib/store-hours: qui conta la regola vera dei 60 minuti.
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

const carrello = {
  groups: [{ sellerId: S1, items: [{ productId: P1, quantity: 1 }], shippingCents: 0 }],
  delivery: { fullName: 'Maria Rossi', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', phone: '3331234567' },
  couponCode: 'SCONTO2',
  pickupInStore: false,
};

function richiesta(corpo: unknown): never {
  return new Request('http://localhost/api/stripe/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  }) as never;
}

async function paga(corpo: unknown = carrello) {
  const { POST } = await import('@/app/api/stripe/checkout/route');
  const res = await (POST as unknown as (req: never) => Promise<Response>)(richiesta(corpo));
  return { stato: res.status, corpo: await res.json() };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  // Lunedì 2/11/2026 alle 17:50 di Roma (UTC+1).
  vi.setSystemTime(new Date('2026-11-02T16:50:00Z'));
  intenti.length = 0;
  rpcChiamate.length = 0;
  sessioniCreate.length = 0;
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://mycity.test');
});

afterEach(() => vi.useRealTimers());

const ALLE_17_50 = new Date(2026, 10, 2, 17, 50);

describe('la carta alle 17:50 rifiuta le fasce a meno di un’ora dalla fine, come i contanti', () => {
  for (const fascia of ['In giornata · 15:00–18:00', 'Oggi · 16:30–18:00', 'Oggi · 13:00–16:30']) {
    it(`«${fascia}» prende il 409 col messaggio dei contanti`, async () => {
      const r = await paga({ ...carrello, couponCode: undefined, deliverySlot: fascia });
      expect(r.stato).toBe(409);
      const motivo = fasciaFuoriTempo(fascia, ALLE_17_50);
      expect(motivo).not.toBeNull();
      expect(JSON.stringify(r.corpo)).toContain(String(motivo));
      expect(sessioniCreate).toHaveLength(0);
    });
  }

  it('la 19:30–21:00 invece passa: il freno non blocca tutto', async () => {
    const r = await paga({ ...carrello, couponCode: undefined, deliverySlot: 'Oggi · 19:30–21:00' });
    expect(r.stato).toBe(200);
  });
});
