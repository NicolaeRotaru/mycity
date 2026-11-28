import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MOTIVO_FASCIA_PIENA, ORDINI_PER_FASCIA } from '@/lib/quando-arriva';

/**
 * R07-009 (onda 2, 28/11/2026) — LA CASSA IN CONTANTI ACCETTAVA ORDINI SENZA LIMITE NELLA STESSA FASCIA.
 *
 * Il tetto deciso è 5 giri per fascia (`ORDINI_PER_FASCIA`, fatto `consegna.capienza`), ma il
 * conteggio stava solo nella rotta della carta, che al lancio è spenta (`CARTA_ACCESA`). La rotta
 * dei contanti, l'unica accesa, scriveva il sesto, il settimo, il decimo ordine nella stessa fascia.
 * Qui gira `POST /api/orders/cod` vera, con una tabella `orders` finta che applica davvero i filtri
 * della lettura (`in` sulla fascia, `gte` sulla data) e conta le righe. Venerdì 27/11/2026 alle
 * 10:00 di Roma; il negozio non ha orari scritti (vale solo la regola dei 60 minuti).
 * (Banco preso da riparazione-onda2-r04-012-contanti-409-fascia.test.ts.)
 */

const NEGOZIO = 'aaaaaaaa-0000-0000-0000-000000000001';
const PRODOTTO = '11111111-1111-1111-1111-111111111111';
const ADESSO = '2026-11-27T09:00:00.000Z'; // 10:00 a Roma
const IERI = '2026-11-26T15:00:00.000Z';
const STAMATTINA = '2026-11-27T07:30:00.000Z';
const FASCIA = 'Domani · 9:00–11:00';

const stato = vi.hoisted(() => ({
  ordini: [] as Array<Record<string, unknown>>,
  inseriti: [] as Array<Record<string, unknown>>,
  letturaRotta: false,
  erroreInserimento: null as null | { code: string; hint?: string; message: string },
  fasceChieste: [] as unknown[][],
}));
const logger = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() }));

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

/** La tabella degli ordini: la lettura dei giri applica i filtri come PostgREST; l'inserimento si registra. */
function tabellaOrdini() {
  return {
    select: (_colonne: string, opzioni?: { count?: string }) => {
      const filtri: Array<(r: Record<string, unknown>) => boolean> = [];
      const q: Record<string, unknown> = {
        in: (c: string, valori: unknown[]) => {
          if (c === 'delivery_slot') stato.fasceChieste.push(valori);
          filtri.push((r) => valori.includes(r[c]));
          return q;
        },
        gte: (c: string, v: string) => (filtri.push((r) => String(r[c]) >= v), q),
        eq: (c: string, v: unknown) => (filtri.push((r) => r[c] === v), q),
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
          if (stato.letturaRotta) return Promise.resolve({ data: null, error: { message: 'giù' }, count: null }).then(ok, ko);
          const righe = stato.ordini.filter((r) => filtri.every((f) => f(r)));
          return Promise.resolve({ data: righe, error: null, count: opzioni?.count ? righe.length : null }).then(ok, ko);
        },
      };
      return q;
    },
    insert: (riga: Record<string, unknown>) => ({
      select: () => ({
        single: () => {
          if (stato.erroreInserimento) return Promise.resolve({ data: null, error: stato.erroreInserimento });
          stato.inseriti.push(riga);
          return Promise.resolve({ data: { id: `ord-${stato.inseriti.length}`, created_at: new Date().toISOString() }, error: null });
        },
      }),
    }),
    delete: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }), then: (ok: (v: unknown) => unknown) => ok({ error: null }) }) }),
  };
}

vi.mock('@/lib/auth/accettazione-testi', async (o) => ({ ...((await o()) as object), vaChiestaSenzaTrattenere: async () => 'lascia-entrare' }));
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
vi.mock('@/lib/ordini/consegna-veloce', async (originale) => ({
  ...(await originale<Record<string, unknown>>()),
  contaFattoriniOnline: vi.fn(async () => 1),
}));
vi.mock('@/lib/promotions', () => ({
  fetchActiveDiscounts: vi.fn(async () => new Map()),
  discountedUnitCents: vi.fn((prezzo: number) => Math.round(prezzo * 100)),
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true, id: 'e1' })) }));
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
  const venditori = [{ id: NEGOZIO, store_name: 'Forno', store_lat: 45.05, store_lng: 9.69, store_hours: null }];
  const from = (table: string): Record<string, unknown> => {
    if (table === 'profiles') return risolvibile({ data: venditori, error: null });
    if (table === 'products') return risolvibile({ data: prodotti, error: null });
    if (table === 'seller_public_profiles') return risolvibile({ data: venditori, error: null });
    if (table === 'product_variants') return risolvibile({ data: [], error: null });
    if (table === 'orders') return tabellaOrdini();
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

/** Un ordine già nella tabella: di un altro cliente, a domicilio, non annullato, nato stamattina per domani. */
function giro(id: string, cliente: string, p: Record<string, unknown> = {}) {
  return {
    id, user_id: cliente, delivery_slot: FASCIA, created_at: STAMATTINA, pickup_in_store: false, delivery_status: 'NEW',
    delivery_address: `Via ${cliente} 1`, delivery_zip: '29121', ...p,
  };
}
const cinqueAltri = () => Array.from({ length: ORDINI_PER_FASCIA }, (_, i) => giro(`o${i}`, `altro-${i}`));

async function ordina(fascia = FASCIA, indirizzo = 'Via Verdi 10'): Promise<{ status: number; messaggio: string }> {
  const { POST } = await import('@/app/api/orders/cod/route');
  const req = new Request('http://localhost/api/orders/cod', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      groups: [{ sellerId: NEGOZIO, items: [{ productId: PRODOTTO, quantity: 1 }] }],
      delivery: { fullName: 'Maria Rossi', address: indirizzo, city: 'Piacenza', zip: '29121', phone: '3331234567' },
      deliverySlot: fascia,
      pickupInStore: false,
      useCredit: false,
    }),
  });
  const res = await (POST as unknown as (req: Request) => Promise<Response>)(req);
  const corpo = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  return { status: res.status, messaggio: corpo.error?.message ?? '' };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(ADESSO));
  stato.ordini = [];
  stato.inseriti = [];
  stato.letturaRotta = false;
  stato.erroreInserimento = null;
  stato.fasceChieste = [];
  logger.error.mockClear();
  vi.resetModules();
});
afterEach(() => vi.useRealTimers());

describe('R07-009 · coi contanti al massimo cinque giri per fascia', () => {
  it('IL CASO CHE ROMPEVA — cinque altri clienti nella fascia: il sesto prende 409 e l’ordine non si scrive', async () => {
    stato.ordini = cinqueAltri();
    const r = await ordina();
    expect(r.status, 'la rotta dei contanti ha scritto il sesto giro nella stessa fascia').toBe(409);
    expect(r.messaggio).toBe(MOTIVO_FASCIA_PIENA);
    expect(stato.inseriti).toHaveLength(0);
  });

  it('controprova: con quattro giri il quinto passa', async () => {
    stato.ordini = cinqueAltri().slice(0, ORDINI_PER_FASCIA - 1);
    const r = await ordina();
    expect(r.status, r.messaggio).toBe(200);
    expect(stato.inseriti).toHaveLength(1);
  });

  it('un carrello di più negozi è un giro solo: le righe dello stesso cliente e indirizzo contano una volta', async () => {
    stato.ordini = [
      ...cinqueAltri().slice(0, 3),
      giro('x1', 'altro-9'), giro('x2', 'altro-9'), giro('x3', 'altro-9'),
    ];
    expect((await ordina()).status).toBe(200);
  });

  it('lo stesso cliente allo stesso indirizzo è la stessa porta: passa anche a fascia piena', async () => {
    stato.ordini = [...cinqueAltri(), giro('mio', 'cliente-1', { delivery_address: ' via  VERDI 10 ' })];
    expect((await ordina()).status).toBe(200);
  });

  it('lo stesso cliente a un altro indirizzo è un altro giro', async () => {
    stato.ordini = [...cinqueAltri().slice(0, 4), giro('mio', 'cliente-1', { delivery_address: 'Via Lontana 99' })];
    const r = await ordina();
    expect(r.status, 'il carrello a un altro indirizzo è stato contato come la stessa porta').toBe(409);
  });

  it('annullati, ritiri in negozio e fasce di altri giorni non contano', async () => {
    stato.ordini = [
      ...cinqueAltri().slice(0, 2),
      giro('a', 'annullato', { delivery_status: 'CANCELED' }),
      giro('r', 'ritiro', { pickup_in_store: true }),
      giro('d', 'ieri', { delivery_slot: 'Oggi · 9:00–11:00', created_at: IERI }), // «Oggi» scelto ieri era giovedì
      giro('e', 'domani-di-ieri', { created_at: IERI }), // «Domani» scelto ieri è oggi, non sabato
      giro('v', 'vecchio', { created_at: '2026-11-20T10:00:00.000Z' }),
    ];
    expect((await ordina()).status).toBe(200);
  });

  it('una fascia di prima che si sovrappone conta: «Domani · 9:00–12:00» di ieri riempie la 11:00–13:00 di oggi', async () => {
    stato.ordini = cinqueAltri().map((o) => ({ ...o, delivery_slot: 'Domani · 9:00–12:00', created_at: IERI }));
    const r = await ordina('Oggi · 11:00–13:00');
    expect(r.status, 'la fascia di prima sovrapposta non è stata contata').toBe(409);
    expect(stato.fasceChieste.at(-1)).toContain('Domani · 9:00–12:00');
  });

  it('la fascia accanto non si sovrappone: cinque giri nella 9:00–11:00 non riempiono la 11:00–13:00', async () => {
    stato.ordini = cinqueAltri();
    expect((await ordina('Domani · 11:00–13:00')).status).toBe(200);
  });

  it('se il database ferma l’ordine (due invii insieme, migrazione 999s) è il 409 della fascia piena, non un 500', async () => {
    stato.erroreInserimento = { code: '23514', hint: 'fascia_piena', message: MOTIVO_FASCIA_PIENA };
    const r = await ordina();
    expect(r.status).toBe(409);
    expect(r.messaggio).toBe(MOTIVO_FASCIA_PIENA);
  });

  it('se il conteggio cade l’ordine passa (tetto morbido), ma resta un errore nel registro', async () => {
    stato.letturaRotta = true;
    const r = await ordina();
    expect(r.status, r.messaggio).toBe(200);
    expect(logger.error.mock.calls.some((c) => String(c[0]).includes('giri della fascia non contati'))).toBe(true);
  });
});
