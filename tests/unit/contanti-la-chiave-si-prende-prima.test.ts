import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 22/8/2026 — LA PROVA CHE MANCAVA SUL PERCORSO DEI SOLDI.
 *
 * La radiografia del 21 agosto lo diceva senza giri di parole: le due strade
 * che creano gli ordini non avevano NESSUNA prova che le percorresse fino in
 * fondo. La protezione contro il doppio invio in contanti era stata scritta,
 * unita e non funzionava — e nessuno poteva accorgersene, perche' non esisteva
 * una prova che diventasse rossa quando si rompeva.
 *
 * Questo file e' quella prova. Chiede tre cose:
 *   ① la chiave del tentativo si prende PRIMA di creare gli ordini, non dopo;
 *   ② un secondo invio con la stessa chiave non crea un secondo ordine;
 *   ③ un invio senza chiave continua a funzionare come prima.
 */
const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
const inseriti: Array<Record<string, unknown>> = [];
const cancellati: Array<{ tabella: string; valore: unknown }> = [];
// #159 — campanelle e posta partite davvero.
const campanelle: Array<Record<string, unknown>> = [];
const postaInviata: Array<Record<string, unknown>> = [];
// #208 — acquisti contati dal server.
const acquistiContati: Array<Record<string, unknown>> = [];

/** Le righe della tabella dei tentativi, come le vedrebbe il database. */
const tentativi = new Map<string, { user_id: string; order_ids: unknown[]; created_at: string }>();
/** In che ordine sono successe le cose: serve a provare che la chiave viene PRIMA. */
const cronologia: string[] = [];

/** Fa fallire la riserva della merce a partire da questa chiamata (1-based). */
let riservaFallisceAllaChiamata = 0;
let chiamateRiserva = 0;

function risolvibile(valore: unknown) {
  const b: Record<string, unknown> = {
    select: () => b,
    eq: () => b,
    in: () => b,
    insert: () => b,
    update: () => b,
    delete: () => b,
    single: () => Promise.resolve(valore),
    maybeSingle: () => Promise.resolve(valore),
    then: (res: (v: unknown) => unknown) => res(valore),
  };
  return b;
}

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/api/middleware', () => ({
  // Il wrapper vero prende (opzioni, gestore) e passa al gestore
  // { user, profile, req }: qui si salta autenticazione e limite di richieste.
  withAuthRateLimit: (
    _opts: unknown,
    h: (ctx: { user: { id: string; email: string; email_confirmed_at: string }; profile: unknown; req: unknown }) => unknown,
  ) => (req: unknown) => h({
    user: { id: 'cliente-1', email: 'cliente@test.it', email_confirmed_at: '2026-01-01T00:00:00Z' },
    profile: { role: 'buyer', is_approved: true },
    req,
  }),
  // Restituisce una risposta solo quando BLOCCA: null = via libera.
  assertCanPurchase: vi.fn(() => null),
}));
vi.mock('@/lib/coupons', () => ({ validateCoupon: vi.fn(async () => ({ ok: false, reason: 'nessuno' })) }));
vi.mock('@/lib/shipping', () => ({
  shippingCentsFor: vi.fn(() => 500),
  compensoRiderCents: vi.fn(() => 250),
}));
vi.mock('@/lib/shipping-coordinate', () => ({
  coordinateDaIndirizziSalvati: vi.fn(async () => null),
}));
vi.mock('@/lib/store-hours', () => ({ isStoreClosedForOrder: vi.fn(() => false) }));
vi.mock('@/lib/promotions', () => ({
  fetchActiveDiscounts: vi.fn(async () => new Map()),
  discountedUnitCents: vi.fn((prezzo: number) => Math.round(prezzo * 100)),
}));
vi.mock('@/lib/email/client', () => ({
  sendEmail: vi.fn(async (m: Record<string, unknown>) => { postaInviata.push(m); return { ok: true, id: 'e1' }; }),
}));
vi.mock('@/lib/email/templates', () => ({
  orderConfirmedBuyerTemplate: vi.fn(() => ({ subject: 's', html: 'h' })),
  newOrderSellerTemplate: vi.fn(() => ({ subject: 's', html: 'h' })),
}));
vi.mock('@/lib/stripe/client', () => ({
  computeOrderSplit: vi.fn(() => ({ applicationFeeCents: 100, sellerPayoutCents: 900 })),
}));
vi.mock('@/lib/analytics/server', () => ({
  contaAcquisto: vi.fn(async (a: Record<string, unknown>) => { acquistiContati.push(a); }),
  misuraAttiva: () => true,
  // 21/8/2026 — Il consenso all'analitica adesso lo legge il server prima di
  // contare: senza questa riga il finto non ha la funzione e la rotta cade.
  analyticsConsentita: vi.fn(async () => true),
}));

vi.mock('@/lib/supabase/server', () => {
  const prodotti = [
    { id: '11111111-1111-1111-1111-111111111111', seller_id: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Pane', price: 5, stock: 10, has_variants: false, images: [], status: 'available' },
    { id: '22222222-2222-2222-2222-222222222222', seller_id: 'bbbbbbbb-0000-0000-0000-000000000002', name: 'Fiori', price: 8, stock: 10, has_variants: false, images: [], status: 'available' },
  ];
  const venditori = [
    { id: 'aaaaaaaa-0000-0000-0000-000000000001', store_name: 'Forno', full_name: null, store_lat: 45.05, store_lng: 9.69, store_hours: null, email: 'a@b.it' },
    { id: 'bbbbbbbb-0000-0000-0000-000000000002', store_name: 'Fiorista', full_name: null, store_lat: 45.06, store_lng: 9.70, store_hours: null, email: 'c@d.it' },
  ];

  const from = (table: string): Record<string, unknown> => {
    if (table === 'products') return risolvibile({ data: prodotti, error: null });
    if (table === 'profiles') return risolvibile({ data: venditori, error: null });
    if (table === 'product_variants') return risolvibile({ data: [], error: null });
    if (table === 'orders') {
      return {
        insert: (valori: Record<string, unknown>) => {
          cronologia.push('ordine');
          inseriti.push(valori);
          return {
            select: () => ({
              single: () => Promise.resolve({ data: { id: `ord-${inseriti.length}` }, error: null }),
            }),
          };
        },
        delete: () => ({
          eq: (_c: string, v: unknown) => {
            cancellati.push({ tabella: 'orders', valore: v });
            return Promise.resolve({ error: null });
          },
        }),
        select: () => risolvibile({ data: [], error: null }),
      };
    }
    if (table === 'order_items') {
      return {
        insert: () => Promise.resolve({ error: null }),
        delete: () => ({
          eq: (_c: string, v: unknown) => {
            cancellati.push({ tabella: 'order_items', valore: v });
            return Promise.resolve({ error: null });
          },
        }),
      };
    }
    if (table === 'cod_checkout_attempts') {
      return {
        insert: (v: Record<string, unknown>) => {
          const chiave = v.chiave as string;
          if (tentativi.has(chiave)) {
            return Promise.resolve({ error: { code: '23505', message: 'duplicato' } });
          }
          cronologia.push('chiave');
          tentativi.set(chiave, {
            user_id: v.user_id as string,
            order_ids: (v.order_ids as unknown[]) ?? [],
            created_at: new Date().toISOString(),
          });
          return Promise.resolve({ error: null });
        },
        update: (v: Record<string, unknown>) => {
          const applica = (chiave: string) => {
            const riga = tentativi.get(chiave);
            if (riga) riga.order_ids = (v.order_ids as unknown[]) ?? riga.order_ids;
          };
          const dopoPrimoEq = (chiave: string) => ({
            eq: () => { applica(chiave); return Promise.resolve({ error: null }); },
            then: (res: (x: unknown) => unknown) => { applica(chiave); return res({ error: null }); },
          });
          return { eq: (_c: string, chiave: string) => dopoPrimoEq(chiave) };
        },
        select: () => ({
          eq: (_c1: string, chiave: string) => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: tentativi.get(chiave) ?? null, error: null }),
            }),
            maybeSingle: () => Promise.resolve({ data: tentativi.get(chiave) ?? null, error: null }),
          }),
        }),
      };
    }
    if (table === 'notifications') {
      return {
        insert: (valori: Record<string, unknown> | Record<string, unknown>[]) => {
          if (Array.isArray(valori)) campanelle.push(...valori);
          else campanelle.push(valori);
          return Promise.resolve({ error: null });
        },
      };
    }
    return risolvibile({ data: [], error: null });
  };

  const rpc = (name: string, args: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    if (name === 'reserve_stock') {
      chiamateRiserva++;
      if (riservaFallisceAllaChiamata > 0 && chiamateRiserva >= riservaFallisceAllaChiamata) {
        return Promise.resolve({ data: null, error: { message: 'merce finita' } });
      }
    }
    if (name === 'wallet_debit') return Promise.resolve({ data: 0, error: null });
    return Promise.resolve({ data: null, error: null });
  };

  return {
    getAdminSupabase: () => ({
      from,
      rpc,
      // Serve alla mail «Nuovo ordine» verso il venditore: senza, quel ramo
      // finiva nel catch e la posta al negozio non veniva nemmeno tentata.
      auth: { admin: { getUserById: async (id: string) => ({ data: { user: { id, email: `${id}@test.it` } } }) } },
    }),
    getServerSupabase: async () => ({
      auth: { getUser: async () => ({ data: { user: { id: 'cliente-1', email: 'cliente@test.it' } } }) },
      from,
    }),
  };
});

function richiesta(chiave?: string): never {
  return new Request('http://localhost/api/orders/cod', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(chiave ? { 'idempotency-key': chiave } : {}),
    },
    body: JSON.stringify({
      groups: [
        { sellerId: 'aaaaaaaa-0000-0000-0000-000000000001', items: [{ productId: '11111111-1111-1111-1111-111111111111', quantity: 1 }], shippingCents: 0 },
        { sellerId: 'bbbbbbbb-0000-0000-0000-000000000002', items: [{ productId: '22222222-2222-2222-2222-222222222222', quantity: 1 }], shippingCents: 0 },
      ],
      delivery: {
        fullName: 'Maria Rossi', address: 'Via Verdi 10', city: 'Piacenza',
        zip: '29121', phone: '3331234567',
      },
      pickupInStore: false,
      useCredit: false,
    }),
  }) as never;
}

async function esegui(chiave?: string) {
  const { POST } = await import('@/app/api/orders/cod/route');
  return (POST as unknown as (req: never) => Promise<Response>)(richiesta(chiave));
}

beforeEach(() => {
  rpcCalls.length = 0;
  inseriti.length = 0;
  cancellati.length = 0;
  campanelle.length = 0;
  postaInviata.length = 0;
  acquistiContati.length = 0;
  chiamateRiserva = 0;
  riservaFallisceAllaChiamata = 0;
  tentativi.clear();
  cronologia.length = 0;
  vi.resetModules();
});


describe('la chiave del tentativo in contanti', () => {
  it('si prende PRIMA di creare gli ordini, non dopo', async () => {
    const res = await esegui('chiave-1');
    expect(res.status).toBe(200);
    // Col codice vecchio la riga si scriveva in fondo: qui l'ordine veniva
    // prima della chiave, e due invii partiti insieme passavano tutti e due.
    expect(cronologia[0]).toBe('chiave');
    expect(cronologia).toContain('ordine');
  });

  it('un secondo invio con la stessa chiave non crea un secondo ordine', async () => {
    await esegui('chiave-2');
    const quantiPrima = inseriti.length;
    expect(quantiPrima).toBe(2);

    const res = await esegui('chiave-2');
    const corpo = await res.json();
    expect(inseriti.length, 'il secondo invio ha creato altri ordini').toBe(quantiPrima);
    expect(corpo.ripetuto).toBe(true);
  });

  it('due chiavi diverse sono due ordini diversi: il cliente che riordina «il solito» ordina davvero', async () => {
    await esegui('chiave-martedi');
    await esegui('chiave-martedi-prossimo');
    expect(inseriti.length).toBe(4);
  });

  it('senza chiave l ordine si fa lo stesso', async () => {
    const res = await esegui();
    expect(res.status).toBe(200);
    expect(inseriti.length).toBe(2);
  });
});
