import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 27/8/2026 (R133) — CHI SBAGLIAVA UNA VOLTA RESTAVA CHIUSO FUORI UN MINUTO,
 * CON IL MESSAGGIO SBAGLIATO.
 *
 * La rotta dei contanti rivendica la chiave del tentativo come PRIMA cosa, con
 * una INSERT: e' giusto, perche' e' quello che ferma il doppio clic vero. Ma
 * poi la riga non veniva tolta da nessuna delle uscite di errore — negozio
 * chiuso, merce finita, codice sconto non piu' valido, prodotto sparito. Il
 * browser, dal canto suo, la chiave la butta solo quando l'ordine riesce.
 *
 * Cosi': primo invio → «Alcuni articoli non sono piu' disponibili», la persona
 * corregge il carrello e ripreme → stessa chiave → la riga c'e' gia', senza
 * ordini e nata da meno di 60 secondi → «Ordine gia in corso, attendi qualche
 * secondo». Che non e' vero: non c'e' nessun ordine in corso, e nessuna attesa
 * lo sblocca prima del minuto. Sul percorso dove si prendono i soldi, un
 * messaggio falso davanti a chi sta comprando.
 *
 * Adesso ogni uscita che non lascia nemmeno un ordine libera la chiave.
 */
const inseriti: Array<Record<string, unknown>> = [];
const tentativi = new Map<string, { user_id: string; order_ids: unknown[]; created_at: string }>();

/** Fa fallire la riserva della merce a partire da questa chiamata (1-based). */
let riservaFallisceAllaChiamata = 0;
let chiamateRiserva = 0;
/** Il negozio risulta chiuso: uscita di errore PRIMA di qualunque scrittura. */
let negozioChiuso = false;

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
vi.mock('@/lib/shipping', () => ({
  shippingCentsFor: vi.fn(() => 500),
  compensoRiderCents: vi.fn(() => 250),
}));
vi.mock('@/lib/shipping-coordinate', () => ({ coordinateDaIndirizziSalvati: vi.fn(async () => null) }));
vi.mock('@/lib/store-hours', () => ({ isStoreClosedForOrder: vi.fn(() => negozioChiuso) }));
vi.mock('@/lib/promotions', () => ({
  fetchActiveDiscounts: vi.fn(async () => new Map()),
  discountedUnitCents: vi.fn((prezzo: number) => Math.round(prezzo * 100)),
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true, id: 'e1' })) }));
vi.mock('@/lib/email/templates', () => ({
  orderConfirmedBuyerTemplate: vi.fn(() => ({ subject: 's', html: 'h' })),
  newOrderSellerTemplate: vi.fn(() => ({ subject: 's', html: 'h' })),
}));
vi.mock('@/lib/stripe/client', () => ({
  computeOrderSplit: vi.fn(() => ({ applicationFeeCents: 100, sellerPayoutCents: 900 })),
}));
vi.mock('@/lib/analytics/server', () => ({
  contaAcquisto: vi.fn(async () => undefined),
  misuraAttiva: () => true,
  analyticsConsentita: vi.fn(async () => true),
}));

vi.mock('@/lib/supabase/server', () => {
  const prodotti = [
    { id: '11111111-1111-1111-1111-111111111111', seller_id: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Pane', price: 5, stock: 10, has_variants: false, images: [], status: 'available' },
    { id: '22222222-2222-2222-2222-222222222222', seller_id: 'bbbbbbbb-0000-0000-0000-000000000002', name: 'Fiori', price: 8, stock: 10, has_variants: false, images: [], status: 'available' },
  ];
  const venditori = [
    { id: 'aaaaaaaa-0000-0000-0000-000000000001', store_name: 'Forno', store_lat: 45.05, store_lng: 9.69, store_hours: null },
    { id: 'bbbbbbbb-0000-0000-0000-000000000002', store_name: 'Fiorista', store_lat: 45.06, store_lng: 9.70, store_hours: null },
  ];

  const from = (table: string): Record<string, unknown> => {
    if (table === 'products') return risolvibile({ data: prodotti, error: null });
    if (table === 'profiles') return risolvibile({ data: venditori, error: null });
    if (table === 'seller_public_profiles') return risolvibile({ data: venditori, error: null });
    if (table === 'product_variants') return risolvibile({ data: [], error: null });
    if (table === 'orders') {
      return {
        insert: (valori: Record<string, unknown>) => {
          inseriti.push(valori);
          return { select: () => ({ single: () => Promise.resolve({ data: { id: `ord-${inseriti.length}` }, error: null }) }) };
        },
        delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
        select: () => risolvibile({ data: [], error: null }),
      };
    }
    if (table === 'order_items') {
      return {
        insert: () => Promise.resolve({ error: null }),
        delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    }
    if (table === 'cod_checkout_attempts') {
      return {
        insert: (v: Record<string, unknown>) => {
          const chiave = v.chiave as string;
          if (tentativi.has(chiave)) return Promise.resolve({ error: { code: '23505', message: 'duplicato' } });
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
        // La cancellazione vera: e' quella che il difetto non faceva mai.
        delete: () => ({
          eq: (_c: string, chiave: string) => {
            const esegui = () => { tentativi.delete(chiave); return { error: null }; };
            return {
              eq: () => Promise.resolve(esegui()),
              then: (res: (x: unknown) => unknown) => res(esegui()),
            };
          },
        }),
        select: () => ({
          eq: (_c1: string, chiave: string) => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: tentativi.get(chiave) ?? null, error: null }) }),
            maybeSingle: () => Promise.resolve({ data: tentativi.get(chiave) ?? null, error: null }),
          }),
        }),
      };
    }
    if (table === 'notifications') return { insert: () => Promise.resolve({ error: null }) };
    return risolvibile({ data: [], error: null });
  };

  const rpc = (name: string) => {
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
      auth: { admin: { getUserById: async (id: string) => ({ data: { user: { id, email: `${id}@test.it` } } }) } },
    }),
    getServerSupabase: async () => ({
      auth: { getUser: async () => ({ data: { user: { id: 'cliente-1', email: 'cliente@test.it' } } }) },
      from,
    }),
  };
});

function richiesta(chiave: string): never {
  return new Request('http://localhost/api/orders/cod', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': chiave },
    body: JSON.stringify({
      groups: [
        { sellerId: 'aaaaaaaa-0000-0000-0000-000000000001', items: [{ productId: '11111111-1111-1111-1111-111111111111', quantity: 1 }] },
        { sellerId: 'bbbbbbbb-0000-0000-0000-000000000002', items: [{ productId: '22222222-2222-2222-2222-222222222222', quantity: 1 }] },
      ],
      delivery: { fullName: 'Maria Rossi', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', phone: '3331234567' },
      pickupInStore: false,
      useCredit: false,
    }),
  }) as never;
}

async function esegui(chiave: string) {
  const { POST } = await import('@/app/api/orders/cod/route');
  return (POST as unknown as (req: never) => Promise<Response>)(richiesta(chiave));
}

beforeEach(() => {
  inseriti.length = 0;
  tentativi.clear();
  chiamateRiserva = 0;
  riservaFallisceAllaChiamata = 0;
  negozioChiuso = false;
});

describe('la chiave del tentativo in contanti, quando l ordine non parte', () => {
  it('dopo «merce finita» si puo riprovare subito, e l ordine si fa', async () => {
    riservaFallisceAllaChiamata = 1;
    const primo = await esegui('chiave-riprova');
    expect(primo.status, 'la merce finita non risponde piu 409').toBe(409);
    expect(inseriti.length, 'e nato un ordine che non doveva nascere').toBe(0);

    // La persona toglie l'articolo esaurito e ripreme. Il browser puo' mandare
    // la stessa chiave: il tentativo di prima non ha lasciato niente in piedi.
    riservaFallisceAllaChiamata = 0;
    chiamateRiserva = 0;
    const secondo = await esegui('chiave-riprova');
    const corpo = await secondo.json();
    expect(
      secondo.status,
      `chi riprova dopo un errore si sente ancora dire «${corpo?.error?.message ?? corpo?.error ?? ''}»`,
    ).toBe(200);
    expect(inseriti.length, 'il secondo tentativo non ha creato gli ordini').toBe(2);
  });

  it('dopo «negozio chiuso» la chiave non resta occupata', async () => {
    negozioChiuso = true;
    const primo = await esegui('chiave-negozio-chiuso');
    expect(primo.status).toBe(409);
    expect(
      tentativi.has('chiave-negozio-chiuso'),
      'la chiave e rimasta presa da un tentativo che non ha creato niente',
    ).toBe(false);

    negozioChiuso = false;
    const secondo = await esegui('chiave-negozio-chiuso');
    expect(secondo.status).toBe(200);
    expect(inseriti.length).toBe(2);
  });

  it('quando gli ordini nascono davvero la chiave resta: e quella che ferma il doppio clic', async () => {
    const res = await esegui('chiave-buona');
    expect(res.status).toBe(200);
    expect(tentativi.has('chiave-buona'), 'la chiave e stata liberata su un ordine riuscito').toBe(true);
    const ancora = await esegui('chiave-buona');
    const corpo = await ancora.json();
    expect(corpo.ripetuto, 'il secondo invio non ha ritrovato gli ordini di prima').toBe(true);
    expect(inseriti.length, 'il secondo invio ha creato altri ordini').toBe(2);
  });
});

/**
 * L'altra meta' della stessa storia, lato browser: la chiave vive in
 * `sessionStorage` e finora si buttava solo quando l'ordine riusciva.
 */
describe('la chiave nel browser dopo un errore', () => {
  it('si butta, cosi chi corregge il carrello e ripreme riparte pulito', async () => {
    const { laChiaveVaButtata } = await import('@/lib/ordini/chiave-dopo-l-errore');
    expect(laChiaveVaButtata({ error: { message: 'Il negozio e chiuso' } })).toBe(true);
    expect(laChiaveVaButtata({})).toBe(true);
    expect(laChiaveVaButtata(undefined)).toBe(true);
  });

  it('ma NON quando il server dice che c e un invio gemello in corso', async () => {
    const { laChiaveVaButtata } = await import('@/lib/ordini/chiave-dopo-l-errore');
    // Li' la chiave e' del gemello che sta creando gli ordini: buttarla vuol
    // dire creare il doppione che tutta questa storia serve a evitare.
    expect(laChiaveVaButtata({ error: 'Ordine gia in corso, attendi qualche secondo.', inCorso: true })).toBe(false);
  });
});
