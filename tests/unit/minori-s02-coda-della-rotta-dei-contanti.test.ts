import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ETICHETTA_ADESSO } from '@/lib/quando-arriva';

/**
 * Sessione S02 (5/11/2026) — la coda della rotta dei contanti.
 *  · scheda 2398: la scadenza dell'email «Nuovo ordine» si conta dal created_at del database;
 *  · scheda 43:   le email partono in fila, mai due chiamate a Resend insieme;
 *  · scheda 2142: la riga finale della chiave che non tocca nessuna riga fa scattare l'allarme.
 * (Il banco è copiato da l-email-nuovo-ordine-dalla-rotta-dei-contanti-dice-la-scadenza-vera.)
 *
 * Originale: L'EMAIL «NUOVO ORDINE» DICE AL NEGOZIO LA SCADENZA VERA, DALLA ROTTA VERA.
 *
 * Il modello dell'email sapeva già scrivere la scadenza, ma la rotta dei contanti non gli passava
 * né la fascia né la nascita dell'ordine: il negozio leggeva sempre «appena puoi». Esempio della
 * scheda: alle 21:15 un cliente ordina da Pane Quotidiano per «Domani · 9:00–12:00»; l'email deve
 * dire «entro le 12:00 di domani». Con la veloce delle 18:05: «entro le 18:15», i 10 minuti del freno.
 *
 * La prova passa dalla rotta vera (`POST /api/orders/cod`) con il modello vero dell'email e
 * `sendEmail` spiato, su un orologio finto.
 */

const NEGOZIO = 'aaaaaaaa-0000-0000-0000-000000000001';
const NEGOZIO2 = 'aaaaaaaa-0000-0000-0000-000000000002';
const PRODOTTO2 = '22222222-2222-2222-2222-222222222222';
const banco = vi.hoisted(() => ({ creatoIl: null as string | null, inVolo: 0, massimo: 0, ordini: 0, prezzoPane: 15 }));
const logger = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() }));
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

vi.mock('@/lib/logger', () => ({ logger }));
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
vi.mock('@/lib/store-hours', async (originale) => ({
  ...(await originale<Record<string, unknown>>()),
  negozioPuoServire: vi.fn(() => true),
}));
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
    banco.inVolo++;
    banco.massimo = Math.max(banco.massimo, banco.inVolo);
    await new Promise((r) => setTimeout(r, 5));
    banco.inVolo--;
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
  const prodotti = [
    { id: PRODOTTO, seller_id: NEGOZIO, name: 'Pane', get price() { return banco.prezzoPane; }, stock: 100, has_variants: false, images: [], status: 'available' },
    { id: PRODOTTO2, seller_id: NEGOZIO2, name: 'Mele', price: 12, stock: 10, has_variants: false, images: [], status: 'available' },
  ];
  const venditori = [
    { id: NEGOZIO, store_name: 'Pane Quotidiano', store_lat: 45.05, store_lng: 9.69, store_hours: null },
    { id: NEGOZIO2, store_name: 'Frutta Bella', store_lat: 45.05, store_lng: 9.69, store_hours: null },
  ];
  const from = (table: string): Record<string, unknown> => {
    if (table === 'profiles') return risolvibile({ data: venditori, error: null });
    if (table === 'products') return risolvibile({ data: prodotti, error: null });
    if (table === 'seller_public_profiles') return risolvibile({ data: venditori, error: null });
    if (table === 'product_variants') return risolvibile({ data: [], error: null });
    if (table === 'orders') {
      return {
        insert: () => ({
          select: () => ({
            single: () => Promise.resolve({ data: { id: `ord-${++banco.ordini}`, created_at: banco.creatoIl }, error: null }),
          }),
        }),
        delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    }
    if (table === 'order_items') return { insert: () => Promise.resolve({ error: null }) };
    if (table === 'notifications') return { insert: () => Promise.resolve({ error: null }) };
    // La riga della chiave esiste ma l'update non la trova: zero righe contate.
    if (table === 'cod_checkout_attempts') return risolvibile({ data: [], count: 0, error: null });
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


function richiesta(deliverySlot: string, opzioni: { dueNegozi?: boolean; chiave?: string; quantita?: number } = {}): never {
  const groups = [{ sellerId: NEGOZIO, items: [{ productId: PRODOTTO, quantity: opzioni.quantita ?? 1 }] }];
  // Il banco legge sempre i due prodotti: il carrello ha sempre i due negozi.
  if (opzioni.dueNegozi) groups.push({ sellerId: NEGOZIO2, items: [{ productId: PRODOTTO2, quantity: 1 }] });
  return new Request('http://localhost/api/orders/cod', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(opzioni.chiave ? { 'idempotency-key': opzioni.chiave } : {}) },
    body: JSON.stringify({
      groups,
      delivery: { fullName: 'Maria Rossi', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', phone: '3331234567' },
      deliverySlot,
      pickupInStore: false,
      useCredit: false,
    }),
  }) as never;
}

async function ordina(ora: string, fascia: string, opzioni: { dueNegozi?: boolean; chiave?: string; quantita?: number } = {}, atteso = 200) {
  vi.setSystemTime(new Date(ora));
  const { POST } = await import('@/app/api/orders/cod/route');
  const res = await (POST as unknown as (req: never) => Promise<Response>)(richiesta(fascia, opzioni));
  expect(res.status, await res.clone().text()).toBe(atteso);
  await new Promise((r) => setTimeout(r, 120));
  return res;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  posta.length = 0;
  banco.creatoIl = null;
  banco.inVolo = 0;
  banco.massimo = 0;
  banco.ordini = 0;
  banco.prezzoPane = 15;
  logger.error.mockClear();
  vi.resetModules();
});
afterEach(() => vi.useRealTimers());

describe('la coda della rotta dei contanti', () => {
  it('2398 · la scadenza dell email si conta dal created_at scritto nel database, non dall ora della rotta', async () => {
    // L'ordine è nato alle 18:05 (database); la rotta arriva all'email alle 18:09.
    banco.creatoIl = '2026-10-30T17:05:00.000Z';
    await ordina('2026-10-30T17:09:00.000Z', ETICHETTA_ADESSO, { dueNegozi: true });
    const alNegozio = posta.find((m) => m.to === `${NEGOZIO}@test.it`);
    expect(alNegozio).toBeTruthy();
    expect(alNegozio!.html).toContain('entro le 18:15');
    expect(alNegozio!.html).not.toContain('entro le 18:19');
  });

  it('43 · con due negozi le email partono una alla volta', async () => {
    await ordina('2026-10-30T20:15:00.000Z', 'Domani · 9:00–12:00', { dueNegozi: true });
    expect(posta.length).toBe(4);
    expect(banco.massimo).toBe(1);
  });

  it('2142 · se la riga finale della chiave non tocca nessuna riga scatta l allarme', async () => {
    await ordina('2026-10-30T20:15:00.000Z', 'Domani · 9:00–12:00', { chiave: 'chiave-della-scheda-1', dueNegozi: true });
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('prova del tentativo NON scritta'),
      expect.objectContaining({ chiave: 'chiave-della-scheda-1' }),
    );
  });

  it('37 · 99 pezzi da 60 € (5.940 €) non si pagano in contanti: 409 «scegli la carta», nessun ordine', async () => {
    banco.prezzoPane = 60;
    const res = await ordina('2026-10-30T20:15:00.000Z', 'Domani · 9:00–12:00', { dueNegozi: true, quantita: 99 }, 409);
    expect(JSON.stringify(await res.json())).toContain('non si può pagare in contanti');
    expect(banco.ordini).toBe(0);
  });

  it('37 · sotto il tetto (99 pezzi da 50 €, 4.950 € + 12 €) l ordine in contanti passa', async () => {
    banco.prezzoPane = 50;
    await ordina('2026-10-30T20:15:00.000Z', 'Domani · 9:00–12:00', { dueNegozi: true, quantita: 99 });
    expect(banco.ordini).toBe(2);
  });
});
