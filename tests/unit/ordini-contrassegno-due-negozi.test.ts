import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Spesa da due negozi pagata in contanti, e la merce del secondo finisce.
 *
 * Il difetto: il ciclo crea un ordine per negozio. Se la riserva della merce
 * fallisce sul secondo, si usciva con «alcuni articoli non sono più
 * disponibili» SENZA annullare l'ordine già creato per il primo. Il cliente
 * credeva di non aver ordinato niente; il primo negozio aveva un ordine vero da
 * preparare, con la merce scalata. Le altre due uscite di errore, poche righe
 * sotto, l'annullamento lo facevano: mancava solo questa.
 *
 * Questa suite copre anche il fatto che il compenso del fattorino venga scritto
 * sull'ordine (prima non lo scriveva nessuno) — la radiografia segnalava zero
 * test sui due percorsi che creano gli ordini.
 */

const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
const inseriti: Array<Record<string, unknown>> = [];
const cancellati: Array<{ tabella: string; valore: unknown }> = [];
// #159 — campanelle e posta partite davvero.
const campanelle: Array<Record<string, unknown>> = [];
const postaInviata: Array<Record<string, unknown>> = [];

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
    if (table === 'notifications') {
      return {
        insert: (valori: Record<string, unknown>) => {
          campanelle.push(valori);
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

function richiesta(): never {
  return new Request('http://localhost/api/orders/cod', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
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

async function esegui() {
  const { POST } = await import('@/app/api/orders/cod/route');
  return (POST as unknown as (req: never) => Promise<Response>)(richiesta());
}

beforeEach(() => {
  rpcCalls.length = 0;
  inseriti.length = 0;
  cancellati.length = 0;
  campanelle.length = 0;
  postaInviata.length = 0;
  chiamateRiserva = 0;
  riservaFallisceAllaChiamata = 0;
  vi.resetModules();
});

describe('ordine in contanti da due negozi', () => {
  it('crea i due ordini quando la merce c e', async () => {
    const res = await esegui();
    expect(res.status).toBe(200);
    expect(inseriti.length).toBe(2);
    expect(cancellati.length).toBe(0);
  });

  it('scrive il compenso del fattorino su ogni ordine', async () => {
    await esegui();
    // Prima questa colonna non veniva popolata da nessuna parte, e al momento
    // del pagamento si ricadeva sul prezzo di spedizione: zero sopra soglia.
    for (const ordine of inseriti) {
      expect(ordine.rider_fee_cents).toBe(250);
    }
  });

  it('se la merce del secondo negozio finisce, annulla anche l ordine del primo', async () => {
    riservaFallisceAllaChiamata = 2;   // la seconda riserva fallisce

    const res = await esegui();
    expect(res.status).toBe(409);

    // L'ordine del primo negozio era stato creato: deve essere stato cancellato.
    expect(inseriti.length).toBe(1);
    expect(cancellati.some((c) => c.tabella === 'orders' && c.valore === 'ord-1')).toBe(true);
    expect(cancellati.some((c) => c.tabella === 'order_items' && c.valore === 'ord-1')).toBe(true);

    // E la merce del primo deve essere tornata disponibile.
    expect(rpcCalls.some((c) => c.name === 'restore_stock')).toBe(true);
  });

  it('se la merce manca subito, non crea nessun ordine', async () => {
    riservaFallisceAllaChiamata = 1;
    const res = await esegui();
    expect(res.status).toBe(409);
    expect(inseriti.length).toBe(0);
  });

  /**
   * #159 — Gli avvisi partivano dentro il ciclo, un negozio per volta. Se il
   * secondo falliva, l'annullamento cancellava gli ordini ma non poteva
   * richiamare indietro le email gia' uscite ne' le campanelle gia' scritte:
   * il negozio A si metteva a preparare pane e fiori per un ordine che non
   * esiste, e il cliente aveva in casella «Ordine ricevuto» dopo aver letto
   * «Alcuni articoli non sono piu' disponibili».
   */
  it('quando il secondo negozio fallisce, nessuno riceve avvisi del primo', async () => {
    riservaFallisceAllaChiamata = 2;
    const res = await esegui();
    expect(res.status).toBe(409);

    expect(campanelle.length, 'campanelle di un ordine annullato').toBe(0);
    expect(postaInviata.length, 'email di un ordine annullato').toBe(0);
  });

  it('quando va tutto bene gli avvisi partono, uno per negozio', async () => {
    const res = await esegui();
    expect(res.status).toBe(200);

    // Due ordini: due campanelle al venditore + due al cliente.
    expect(campanelle.length).toBe(4);
    // Due email al venditore + due di conferma al cliente.
    expect(postaInviata.length).toBe(4);
    // E i link puntano agli ordini veri, non a pagine cancellate.
    for (const c of campanelle) {
      expect(String(c.link)).toMatch(/ord-[12]/);
    }
  });
});
