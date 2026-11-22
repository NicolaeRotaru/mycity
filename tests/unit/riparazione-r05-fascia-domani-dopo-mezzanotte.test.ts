import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * R05-011 — «DOMANI» PREMUTO ALLE 23:59 E ARRIVATO ALLA ROTTA DOPO MEZZANOTTE.
 *
 * Lunedì 23/11 alle 23:59 la cassa propone «Domani · 9:00–11:00», cioè martedì 24, e manda anche
 * il giorno di Roma della fascia (`delivery_date: '2026-11-24'`). La richiesta arriva alla rotta
 * dei contanti martedì alle 00:01: la rotta contava «Domani» dal suo orologio, giudicava (e
 * scriveva) la fascia per mercoledì 25. Il forno aperto solo martedì veniva rifiutato; quello
 * aperto solo mercoledì passava, con l'ordine scritto per il giorno sbagliato.
 *
 * Qui gira la rotta vera (`POST /api/orders/cod`) su un orologio finto, con gli orari veri
 * (lib/store-hours non è finto). Le finte vengono dalla prova R12 della stessa rotta, con in più
 * la fascia scritta sull'ordine.
 */

const NEGOZIO = 'aaaaaaaa-0000-0000-0000-000000000001';
const PRODOTTO = '11111111-1111-1111-1111-111111111111';
const stato = vi.hoisted(() => ({
  orari: null as unknown,
  inseriti: [] as Array<Record<string, unknown>>,
}));

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
  const venditori = () => [{ id: NEGOZIO, store_name: 'Pane Quotidiano', store_lat: 45.05, store_lng: 9.69, store_hours: stato.orari }];
  const from = (table: string): Record<string, unknown> => {
    if (table === 'profiles') return risolvibile({ data: venditori(), error: null });
    if (table === 'products') return risolvibile({ data: prodotti, error: null });
    if (table === 'seller_public_profiles') return risolvibile({ data: venditori(), error: null });
    if (table === 'product_variants') return risolvibile({ data: [], error: null });
    if (table === 'orders') {
      return {
        insert: (riga: Record<string, unknown> | Array<Record<string, unknown>>) => {
          for (const r of Array.isArray(riga) ? riga : [riga]) stato.inseriti.push(r);
          return { select: () => ({ single: () => Promise.resolve({ data: { id: 'ord-1' }, error: null }) }) };
        },
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

const CHIUSO: [string, string][] = [];
const MATTINA: [string, string][] = [['08:00', '13:00']];
const settimana = (aperti: Partial<Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', [string, string][]>>) => ({
  mon: CHIUSO, tue: CHIUSO, wed: CHIUSO, thu: CHIUSO, fri: CHIUSO, sat: CHIUSO, sun: CHIUSO, ...aperti,
});
const SOLO_MARTEDI = settimana({ tue: MATTINA });
const SOLO_MERCOLEDI = settimana({ wed: MATTINA });
const TUTTO_IL_GIORNO: [string, string][] = [['08:00', '22:00']];
const SEMPRE_APERTO = settimana({
  mon: TUTTO_IL_GIORNO, tue: TUTTO_IL_GIORNO, wed: TUTTO_IL_GIORNO, thu: TUTTO_IL_GIORNO,
  fri: TUTTO_IL_GIORNO, sat: TUTTO_IL_GIORNO, sun: TUTTO_IL_GIORNO,
});

// Novembre: Roma è un'ora avanti a UTC.
const MARTEDI_00_01 = '2026-11-23T23:01:00.000Z';
const MARTEDI_00_05 = '2026-11-23T23:05:00.000Z';
const LUNEDI_23_30 = '2026-11-23T22:30:00.000Z';

function richiesta(deliverySlot: string, giornoDellaFascia?: string): never {
  return new Request('http://localhost/api/orders/cod', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      groups: [{ sellerId: NEGOZIO, items: [{ productId: PRODOTTO, quantity: 1 }] }],
      delivery: { fullName: 'Maria Rossi', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', phone: '3331234567' },
      deliverySlot,
      ...(giornoDellaFascia === undefined ? {} : { delivery_date: giornoDellaFascia }),
      pickupInStore: false,
      useCredit: false,
    }),
  }) as never;
}

async function chiama(ora: string, orari: unknown, fascia: string, giornoDellaFascia?: string) {
  vi.setSystemTime(new Date(ora));
  stato.orari = orari;
  const { POST } = await import('@/app/api/orders/cod/route');
  return (POST as unknown as (req: never) => Promise<Response>)(richiesta(fascia, giornoDellaFascia));
}

const fasceScritte = () => stato.inseriti.map((r) => r.delivery_slot);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  stato.inseriti.length = 0;
  vi.resetModules();
});
afterEach(() => vi.useRealTimers());

describe('R05-011 la fascia «Domani» si conta dal giorno in cui la cassa l ha proposta', () => {
  it('IL CASO: proposta lunedì per martedì, arrivata martedì alle 00:01, forno aperto solo martedì → passa, scritta per oggi', async () => {
    const res = await chiama(MARTEDI_00_01, SOLO_MARTEDI, 'Domani · 9:00–11:00', '2026-11-24');
    expect(res.status, await res.clone().text()).toBe(200);
    expect(fasceScritte()).toEqual(['Oggi · 9:00–11:00']);
  });

  it('lo stesso ordine col forno aperto solo mercoledì si ferma: martedì è chiuso', async () => {
    const res = await chiama(MARTEDI_00_01, SOLO_MERCOLEDI, 'Domani · 9:00–11:00', '2026-11-24');
    expect(res.status, await res.clone().text()).toBe(409);
    expect(stato.inseriti, 'ordine scritto per il giorno sbagliato').toEqual([]);
  });

  it('una fascia di lunedì sera arrivata dopo mezzanotte è passata, anche col negozio aperto martedì sera', async () => {
    const res = await chiama(MARTEDI_00_05, SEMPRE_APERTO, 'Oggi · 19:30–21:00', '2026-11-23');
    expect(res.status, await res.clone().text()).toBe(409);
    expect(stato.inseriti).toEqual([]);
  });

  it('arrivata prima di mezzanotte non cambia niente: resta «Domani»', async () => {
    const res = await chiama(LUNEDI_23_30, SOLO_MARTEDI, 'Domani · 9:00–11:00', '2026-11-24');
    expect(res.status, await res.clone().text()).toBe(200);
    expect(fasceScritte()).toEqual(['Domani · 9:00–11:00']);
  });

  it('senza il giorno (una cassa aperta da prima) o con un giorno sballato di giorni, si giudica come prima', async () => {
    for (const giorno of [undefined, '2026-11-20', '2026-11-30', 'non-una-data']) {
      stato.inseriti.length = 0;
      vi.resetModules();
      const res = await chiama(MARTEDI_00_01, SOLO_MERCOLEDI, 'Domani · 9:00–11:00', giorno);
      expect(res.status, `${giorno}: ${await res.clone().text()}`).toBe(200);
      expect(fasceScritte(), String(giorno)).toEqual(['Domani · 9:00–11:00']);
    }
  });
});
