import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * 15/10/2026 (R24) — LA CONFERMA DELL'ORDINE IN CONTANTI USCIVA COME PUBBLICITA'.
 *
 * Il contrassegno e' il metodo pensato per il cliente anziano di Piacenza. La
 * sua conferma d'ordine e l'avviso «nuovo ordine» al negozio partono dalla
 * rotta dei contanti, che non dichiarava il tipo di email: e `sendEmail`
 * trattava come commerciale chi non dichiarava niente. Risultato: in fondo alla
 * conferma «Annulla l'iscrizione con un clic», e accanto al mittente il
 * pulsante «Annulla iscrizione» di Gmail. Chi lo premeva spegneva le
 * promozioni credendo di spegnere gli avvisi dell'ordine.
 *
 * Qui si esegue la rotta VERA dei contanti, con il client della posta e i
 * modelli veri: e' finto solo Resend, e si guarda il pacchetto che gli arriva.
 * Lo scaffale finto del database e' lo stesso di
 * `la-posta-del-contrassegno-non-fa-la-fila.test.ts`.
 */

const NEGOZI = [
  'aaaaaaaa-0000-0000-0000-000000000001',
  'bbbbbbbb-0000-0000-0000-000000000002',
  'cccccccc-0000-0000-0000-000000000003',
];
const PRODOTTI = [
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333',
];

const inseriti: Array<Record<string, unknown>> = [];

type Pacchetto = { to?: string | string[]; subject?: string; html?: string; headers?: Record<string, string> };
/** Il pacchetto vero, come lo riceve il servizio di posta: qui e' finto solo Resend. */
const alServizioDiPosta: Pacchetto[] = [];
vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: async (p: Pacchetto) => {
        alServizioDiPosta.push(p);
        return { data: { id: 'msg-1' }, error: null };
      },
    };
  },
}));

function risolvibile(valore: unknown) {
  const b: Record<string, unknown> = {
    select: () => b,
    eq: () => b,
    in: () => b,
    is: () => b,
    insert: () => b,
    update: () => b,
    delete: () => b,
    order: () => b,
    limit: () => b,
    single: () => Promise.resolve(valore),
    maybeSingle: () => Promise.resolve(valore),
    then: (res: (v: unknown) => unknown) => res(valore),
  };
  return b;
}

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit: (
    _opts: unknown,
    h: (ctx: { user: { id: string; email: string; email_confirmed_at: string }; profile: unknown; req: unknown }) => unknown,
  ) => (req: unknown) => h({
    user: { id: 'cliente-1', email: 'cliente@test.it', email_confirmed_at: '2026-01-01T00:00:00Z' },
    profile: { role: 'buyer', is_approved: true },
    req,
  }),
  assertCanPurchase: vi.fn(() => null),
}));
vi.mock('@/lib/coupons', () => ({ validateCoupon: vi.fn(async () => ({ ok: false, reason: 'nessuno' })) }));
vi.mock('@/lib/shipping', () => ({ shippingCentsFor: vi.fn(() => 500), compensoRiderCents: vi.fn(() => 250) }));
vi.mock('@/lib/shipping-coordinate', () => ({ coordinateDaIndirizziSalvati: vi.fn(async () => null) }));
// 3/9/2026 — la rotta adesso decide con `negozioPuoServire`, che guarda la fascia
// scelta e non solo l'orologio (l'ordine serale per domani non si rifiuta piu').
vi.mock('@/lib/store-hours', () => ({
  negozioPuoServire: vi.fn(() => true),
  motivoNegozioChiuso: vi.fn((n: string) => `${n} è chiuso in questo momento.`),
}));
vi.mock('@/lib/promotions', () => ({
  fetchActiveDiscounts: vi.fn(async () => new Map()),
  discountedUnitCents: vi.fn((prezzo: number) => Math.round(prezzo * 100)),
}));
vi.mock('@/lib/stripe/client', () => ({
  computeOrderSplit: vi.fn(() => ({ applicationFeeCents: 100, sellerPayoutCents: 900 })),
}));
vi.mock('@/lib/analytics/server', () => ({
  contaAcquisto: vi.fn(async () => undefined),
  misuraAttiva: () => true,
  analyticsConsentita: vi.fn(async () => false),
}));

vi.mock('@/lib/supabase/server', () => {
  const prodotti = PRODOTTI.map((id, i) => ({
    id, seller_id: NEGOZI[i], name: `Roba ${i}`, price: 5, stock: 10, has_variants: false, images: [], status: 'available',
  }));
  const venditori = NEGOZI.map((id, i) => ({
    id, store_name: `Negozio ${i}`, store_lat: 45.05, store_lng: 9.69, store_hours: null,
  }));

  const tabellaProfili = () => ({
    select: () => ({
      // La lettura vecchia: una per ordine.
      eq: () => ({
        single: () => Promise.resolve({ data: venditori[0], error: null }),
      }),
      // Quella nuova: tutti i negozi del carrello in un colpo solo.
      in: () => Promise.resolve({ data: venditori, error: null }),
    }),
  });

  const from = (table: string): Record<string, unknown> => {
    if (table === 'profiles') return tabellaProfili() as unknown as Record<string, unknown>;
    if (table === 'products') return risolvibile({ data: prodotti, error: null });
    if (table === 'seller_public_profiles') return risolvibile({ data: venditori, error: null });
    if (table === 'product_variants') return risolvibile({ data: [], error: null });
    if (table === 'orders') {
      return {
        insert: (valori: Record<string, unknown>) => {
          inseriti.push(valori);
          return { select: () => ({ single: () => Promise.resolve({ data: { id: `ord-${inseriti.length}` }, error: null }) }) };
        },
        delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    }
    if (table === 'order_items') return { insert: () => Promise.resolve({ error: null }) };
    if (table === 'notifications') return { insert: () => Promise.resolve({ error: null }) };
    return risolvibile({ data: [], error: null });
  };

  const rpc = (name: string) => {
    if (name === 'wallet_debit') return Promise.resolve({ data: 0, error: null });
    return Promise.resolve({ data: null, error: null });
  };

  return {
    getAdminSupabase: () => ({
      from,
      rpc,
      auth: {
        admin: {
          getUserById: async (id: string) => ({ data: { user: { id, email: `${id}@test.it` } } }),
        },
      },
    }),
    getServerSupabase: async () => ({
      auth: { getUser: async () => ({ data: { user: { id: 'cliente-1', email: 'cliente@test.it' } } }) },
      from,
    }),
  };
});

function richiesta(): never {
  return new Request('http://localhost/api/orders/cod', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      groups: NEGOZI.map((sellerId, i) => ({
        sellerId,
        items: [{ productId: PRODOTTI[i], quantity: 1 }],
      })),
      delivery: { fullName: 'Maria Rossi', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', phone: '3331234567' },
      pickupInStore: false,
      useCredit: false,
    }),
  }) as never;
}

beforeEach(() => {
  inseriti.length = 0;
  alServizioDiPosta.length = 0;
  vi.resetModules();
  vi.stubEnv('RESEND_API_KEY', 're_prova');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://mycity.example');
  vi.stubEnv('UNSUBSCRIBE_SECRET', 'un-segreto-lungo-abbastanza');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('la posta dell ordine in contanti', () => {
  it('conferma al cliente e avviso al negozio escono senza il tasto per smettere', async () => {
    const { POST } = await import('@/app/api/orders/cod/route');
    const res = await (POST as unknown as (req: never) => Promise<Response>)(richiesta());
    expect(res.status).toBe(200);
    // La posta parte dopo la risposta: le si lascia il tempo di uscire.
    await new Promise((r) => setTimeout(r, 60));

    const alCliente = alServizioDiPosta.filter((p) => p.to === 'cliente@test.it');
    const aiNegozi = alServizioDiPosta.filter((p) => NEGOZI.some((n) => p.to === `${n}@test.it`));
    expect(alCliente.length, 'le conferme al cliente non sono partite').toBe(3);
    expect(aiNegozi.length, 'gli avvisi ai negozi non sono partiti').toBe(3);

    for (const p of [...alCliente, ...aiNegozi]) {
      const html = String(p.html ?? '');
      expect(html, `«${p.subject}»: chi preme «Annulla l'iscrizione» spegne le promozioni credendo di spegnere gli avvisi`).not.toContain('/api/unsubscribe');
      expect(html).not.toContain("Annulla l'iscrizione");
      expect(p.headers?.['List-Unsubscribe'], `«${p.subject}»: Gmail accende il pulsante «Annulla iscrizione»`).toBeUndefined();
      expect(p.headers?.['List-Unsubscribe-Post']).toBeUndefined();
    }
  });
});
