import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ETICHETTA_ADESSO } from '@/lib/quando-arriva';

/**
 * R03-012 — DUE VELOCI VENDUTE NELLO STESSO ISTANTE CON UN SOLO FATTORINO.
 *
 * La rotta dei contanti legge «un fattorino libero» prima di inserire: due clienti insieme lo
 * leggevano tutti e due e nascevano due veloci. Il lucchetto sta nel database (migrazione 840,
 * provata da tests/sql/rls/riparazione-r03-veloce.test.sql): la seconda veloce si ferma con 23514
 * e il segno `veloce_senza_fattorino_libero`. Qui gira la rotta vera (`POST /api/orders/cod`) e si
 * guarda che quel rifiuto arrivi al cliente come il 409 «non c'è un fattorino libero», con la merce
 * rimessa e niente avvisi, invece di un 500 «Errore nella creazione ordine». E che un ordine NON
 * veloce passi esattamente come prima.
 *
 * Le finte vengono dalla prova R05 della stessa rotta.
 */

const NEGOZIO = 'aaaaaaaa-0000-0000-0000-000000000001';
const PRODOTTO = '11111111-1111-1111-1111-111111111111';
const RIFIUTO_DEL_DATABASE = {
  code: '23514',
  message: "Adesso non c'è un fattorino libero per la consegna veloce. Scegli una fascia oraria: la consegna arriva quando la scegli tu.",
  hint: 'veloce_senza_fattorino_libero',
  details: null,
};
const stato = vi.hoisted(() => ({
  inseriti: [] as Array<Record<string, unknown>>,
  erroreInserimento: null as null | Record<string, unknown>,
  chiamate: [] as string[],
  campanelle: 0,
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
// Il fattorino solo risulta libero a tutti e due gli invii: è la lettura che precede l'inserimento.
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
  const TUTTO_IL_GIORNO: [string, string][] = [['08:00', '22:00']];
  const orari = {
    mon: TUTTO_IL_GIORNO, tue: TUTTO_IL_GIORNO, wed: TUTTO_IL_GIORNO, thu: TUTTO_IL_GIORNO,
    fri: TUTTO_IL_GIORNO, sat: TUTTO_IL_GIORNO, sun: TUTTO_IL_GIORNO,
  };
  const prodotti = [{ id: PRODOTTO, seller_id: NEGOZIO, name: 'Pane', price: 15, stock: 10, has_variants: false, images: [], status: 'available' }];
  const venditori = () => [{ id: NEGOZIO, store_name: 'Pane Quotidiano', store_lat: 45.05, store_lng: 9.69, store_hours: orari }];
  const from = (table: string): Record<string, unknown> => {
    if (table === 'profiles') return risolvibile({ data: venditori(), error: null });
    if (table === 'products') return risolvibile({ data: prodotti, error: null });
    if (table === 'seller_public_profiles') return risolvibile({ data: venditori(), error: null });
    if (table === 'product_variants') return risolvibile({ data: [], error: null });
    if (table === 'orders') {
      return {
        ...risolvibile({ data: null, error: null }),
        insert: (riga: Record<string, unknown> | Array<Record<string, unknown>>) => {
          const righe = Array.isArray(riga) ? riga : [riga];
          return {
            select: () => ({
              single: () => {
                if (stato.erroreInserimento) return Promise.resolve({ data: null, error: stato.erroreInserimento });
                for (const r of righe) stato.inseriti.push(r);
                return Promise.resolve({ data: { id: 'ord-1', created_at: '2026-11-24T09:00:00.000Z' }, error: null });
              },
            }),
          };
        },
        delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    }
    if (table === 'order_items') return { insert: () => Promise.resolve({ error: null }) };
    if (table === 'notifications') {
      return {
        insert: () => {
          stato.campanelle++;
          return Promise.resolve({ error: null });
        },
      };
    }
    return risolvibile({ data: [], error: null });
  };
  return {
    getAdminSupabase: () => ({
      from,
      rpc: (name: string) => {
        stato.chiamate.push(name);
        return Promise.resolve({ data: name === 'wallet_debit' ? 0 : null, error: null });
      },
      auth: { admin: { getUserById: async (id: string) => ({ data: { user: { id, email: `${id}@test.it` } } }) } },
    }),
    getServerSupabase: async () => ({
      auth: { getUser: async () => ({ data: { user: { id: 'cliente-1', email: 'cliente@test.it' } } }) },
      from,
    }),
  };
});

// Martedì 24/11 alle 10:00 di Roma (novembre: un'ora avanti a UTC). La veloce si può: 8-21, negozio aperto.
const MARTEDI_ALLE_10 = '2026-11-24T09:00:00.000Z';
const UNA_FASCIA = 'Oggi · 13:00–16:30';

function richiesta(deliverySlot: string, chiave?: string): never {
  return new Request('http://localhost/api/orders/cod', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(chiave ? { 'idempotency-key': chiave } : {}) },
    body: JSON.stringify({
      groups: [{ sellerId: NEGOZIO, items: [{ productId: PRODOTTO, quantity: 1 }] }],
      delivery: { fullName: 'Maria Rossi', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', phone: '3331234567' },
      deliverySlot,
      pickupInStore: false,
      useCredit: false,
    }),
  }) as never;
}

async function chiama(fascia: string, chiave?: string) {
  vi.setSystemTime(new Date(MARTEDI_ALLE_10));
  const { POST } = await import('@/app/api/orders/cod/route');
  return (POST as unknown as (req: never) => Promise<Response>)(richiesta(fascia, chiave));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  stato.inseriti.length = 0;
  stato.chiamate.length = 0;
  stato.campanelle = 0;
  stato.erroreInserimento = null;
  vi.resetModules();
});
afterEach(() => vi.useRealTimers());

describe('R03-012 la seconda veloce col fattorino già preso si ferma con il suo motivo', () => {
  it('IL CASO: il database ferma la veloce (23514, veloce_senza_fattorino_libero) → 409 «non c è un fattorino libero», non 500', async () => {
    stato.erroreInserimento = RIFIUTO_DEL_DATABASE;
    const res = await chiama(ETICHETTA_ADESSO);
    const testo = await res.clone().text();
    expect(res.status, testo).toBe(409);
    expect(testo).toContain('fattorino libero');
    expect(stato.inseriti, 'nessun ordine nato').toEqual([]);
    expect(stato.chiamate, 'la merce riservata torna sullo scaffale').toContain('restore_stock');
    expect(stato.campanelle, 'nessun «nuovo ordine» al negozio').toBe(0);
  });

  it('lo stesso con la chiave del browser (il caso vero della cassa): 409, non 500', async () => {
    stato.erroreInserimento = RIFIUTO_DEL_DATABASE;
    const res = await chiama(ETICHETTA_ADESSO, 'chiave-r03-012');
    const testo = await res.clone().text();
    expect(res.status, testo).toBe(409);
    expect(testo).toContain('fattorino libero');
  });

  it('un ordine non veloce passa come prima', async () => {
    const res = await chiama(UNA_FASCIA);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(stato.inseriti.map((r) => r.delivery_slot)).toEqual([UNA_FASCIA]);
  });

  it('la prima veloce, col fattorino libero, nasce come prima', async () => {
    const res = await chiama(ETICHETTA_ADESSO);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(stato.inseriti.map((r) => r.delivery_slot)).toEqual([ETICHETTA_ADESSO]);
  });

  it('un altro errore del database resta un guasto (500), veloce o no: il 409 è solo per quel segno', async () => {
    const casi: Array<[string, Record<string, unknown>]> = [
      [UNA_FASCIA, { code: 'XX000', message: 'guasto', hint: null, details: null }],
      [ETICHETTA_ADESSO, { code: 'XX000', message: 'guasto', hint: null, details: null }],
      [ETICHETTA_ADESSO, { code: '23514', message: 'altra regola', hint: null, details: null }],
    ];
    for (const [fascia, errore] of casi) {
      stato.erroreInserimento = errore;
      vi.resetModules();
      const res = await chiama(fascia);
      expect(res.status, `${fascia} ${String(errore.code)}: ${await res.clone().text()}`).toBe(500);
    }
  });
});
