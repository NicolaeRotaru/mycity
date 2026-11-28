import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * R04-012 (onda 2, 28/11/2026) — IL 409 DELLA ROTTA DEI CONTANTI, PROVATO FACENDO GIRARE LA ROTTA.
 *
 * `la-rotta-rifiuta-una-fascia-a-meno-di-un-ora-dalla-fine.test.ts` provava la regola da sola e, per
 * la rotta, cercava `ApiErrors.conflict(rifiutata)` nel sorgente: una rotta che non passa gli orari
 * del negozio alla regola (o che li legge senza `store_hours`) passava. Qui gira `POST
 * /api/orders/cod` vera, con Pane Quotidiano (lun-sab 9-13 e 16:30-19:30) nella tabella finta, che
 * restituisce gli orari solo se la lettura li chiede, come il database. Lunedì 2/11/2026:
 *  · 14:00, «Oggi · 13:00–16:30» → 409 col nome del negozio (forno chiuso fino alle 16:30: regola
 *    degli orari; per i soli 60 minuti sarebbe ancora buona);
 *  · 17:31, «Oggi · 16:30–18:00» → 409 (regola dei 60 minuti);
 *  · controprova: 12:00, la stessa «Oggi · 13:00–16:30» → 200 (si ritira entro le 12:45).
 * (Banco preso da l-email-dei-contanti-legge-gli-orari-del-negozio.test.ts.)
 */
const { ORARI_PQ } = vi.hoisted(() => {
  const giorno = [['09:00', '13:00'], ['16:30', '19:30']];
  return {
    ORARI_PQ: { mon: giorno, tue: giorno, wed: giorno, thu: [['09:00', '13:00']], fri: giorno, sat: giorno, sun: [] },
  };
});


const NEGOZIO = 'aaaaaaaa-0000-0000-0000-000000000001';
const PRODOTTO = '11111111-1111-1111-1111-111111111111';
const posta: Array<{ to: string; html: string; text?: string }> = [];

function risolvibile(valore: unknown) {
  const b: Record<string, unknown> = {
    select: () => b, eq: () => b, in: () => b, is: () => b, insert: () => b, update: () => b, delete: () => b,
    order: () => b, limit: () => b, gte: () => b, lte: () => b, lt: () => b, gt: () => b, neq: () => b, contains: () => b,
    single: () => Promise.resolve(valore),
    maybeSingle: () => Promise.resolve(valore),
    then: (res: (v: unknown) => unknown) => res(valore),
  };
  return b;
}

vi.mock('@/lib/auth/accettazione-testi', async (o) => ({ ...((await o()) as object), vaChiestaSenzaTrattenere: async () => 'lascia-entrare' }));
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
vi.mock('@/lib/shipping', () => ({ shippingCentsFor: vi.fn(() => 300), compensoRiderCents: vi.fn(() => 300) }));
vi.mock('@/lib/shipping-coordinate', () => ({ coordinateDaIndirizziSalvati: vi.fn(async () => null) }));
// Gli orari NON si fingono: la regola del ritiro (negozioPuoServire) gira davvero.
// La veloce si vende solo con un fattorino online: qui ce n'è uno (al lancio è Nicola).
vi.mock('@/lib/ordini/consegna-veloce', async (originale) => ({
  ...(await originale<Record<string, unknown>>()),
  contaFattoriniOnline: vi.fn(async () => 1),
}));
vi.mock('@/lib/promotions', () => ({
  fetchActiveDiscounts: vi.fn(async () => new Map()),
  discountedUnitCents: vi.fn((prezzo: number) => Math.round(prezzo * 100)),
}));
vi.mock('@/lib/email/client', () => ({
  sendEmail: vi.fn(async (m: { to: string; html: string; text?: string }) => {
    posta.push({ to: m.to, html: m.html, text: m.text });
    return { ok: true, id: 'e1' };
  }),
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
  const prodotti = [{ id: PRODOTTO, seller_id: NEGOZIO, name: 'Pane', price: 15, stock: 10, has_variants: false, images: [], status: 'available' }];
  const venditori = [{ id: NEGOZIO, store_name: 'Pane Quotidiano', store_lat: 45.05, store_lng: 9.69, store_hours: ORARI_PQ as unknown }];
  const from = (table: string): Record<string, unknown> => {
    if (table === 'profiles') {
      // Come il database: gli orari tornano solo se la lettura li chiede.
      return {
        ...risolvibile({ data: venditori, error: null }),
        select: (colonne?: string) => risolvibile({
          data: !colonne || /store_hours|\*/.test(colonne) ? venditori : venditori.map(({ store_hours: _o, ...r }) => r),
          error: null,
        }),
      };
    }
    if (table === 'products') return risolvibile({ data: prodotti, error: null });
    if (table === 'seller_public_profiles') return risolvibile({ data: venditori, error: null });
    if (table === 'product_variants') return risolvibile({ data: [], error: null });
    if (table === 'orders') {
      return {
        insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'ord-1' }, error: null }) }) }),
        delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    }
    if (table === 'order_items') return { insert: () => Promise.resolve({ error: null }) };
    if (table === 'notifications') return { insert: () => Promise.resolve({ error: null }) };
    return risolvibile({ data: [], error: null });
  };
  return {
    getAdminSupabase: () => ({
      from,
      rpc: (name: string) => Promise.resolve({ data: name === 'wallet_debit' ? 0 : null, error: null }),
      auth: { admin: { getUserById: async (id: string) => ({ data: { user: { id, email: `${id}@test.it` } } }) } },
    }),
    getServerSupabase: async () => ({
      auth: { getUser: async () => ({ data: { user: { id: 'cliente-1', email: 'cliente@test.it' } } }) },
      from,
    }),
  };
});

function richiesta(deliverySlot: string): never {
  return new Request('http://localhost/api/orders/cod', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      groups: [{ sellerId: NEGOZIO, items: [{ productId: PRODOTTO, quantity: 1 }] }],
      delivery: { fullName: 'Maria Rossi', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', phone: '3331234567' },
      deliverySlot,
      pickupInStore: false,
      useCredit: false,
    }),
  }) as never;
}

async function ordina(ora: string, fascia: string): Promise<{ status: number; messaggio: string }> {
  vi.setSystemTime(new Date(ora));
  const { POST } = await import('@/app/api/orders/cod/route');
  const res = await (POST as unknown as (req: never) => Promise<Response>)(richiesta(fascia));
  const corpo = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  return { status: res.status, messaggio: corpo.error?.message ?? '' };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  posta.length = 0;
  vi.resetModules();
});
afterEach(() => vi.useRealTimers());

describe('R04-012 · la rotta dei contanti rifiuta con 409 le fasce che la cassa non propone', () => {
  it('IL CASO CHE ROMPEVA — lunedì 14:00, «Oggi · 13:00–16:30»: 409, perché il forno è chiuso fino alle 16:30', async () => {
    const r = await ordina('2026-11-02T13:00:00.000Z', 'Oggi · 13:00–16:30');
    expect(r.status, 'la rotta ha accettato una fascia che il negozio non può servire').toBe(409);
    expect(r.messaggio).toMatch(/Pane Quotidiano/);
  });

  it('lunedì 17:31, «Oggi · 16:30–18:00»: 409, a meno di un’ora dalla fine', async () => {
    const r = await ordina('2026-11-02T16:31:00.000Z', 'Oggi · 16:30–18:00');
    expect(r.status).toBe(409);
    expect(r.messaggio.length).toBeGreaterThan(0);
  });

  it('controprova: lunedì 12:00 la «Oggi · 13:00–16:30» si accetta (si ritira entro le 12:45)', async () => {
    const r = await ordina('2026-11-02T11:00:00.000Z', 'Oggi · 13:00–16:30');
    expect(r.status, r.messaggio).toBe(200);
  });
});
