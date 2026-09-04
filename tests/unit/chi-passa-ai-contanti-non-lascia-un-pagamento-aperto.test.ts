import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * 3/9/2026 — CHI PASSA DALLA CARTA AI CONTANTI SI PORTAVA DIETRO UNA PAGINA DI
 * PAGAMENTO ANCORA VIVA.
 *
 * Sabato mattina Maria preme «Paga con carta»: il server le mette da parte la
 * merce e le apre la scheda di Stripe. Ci ripensa, torna sul sito e sceglie
 * «pago alla consegna». L'ordine in contanti nasce, e la merce che aveva
 * impegnato con la carta torna a scaffale.
 *
 * Ma la scheda di Stripe è rimasta aperta nell'altra linguetta del browser. Se
 * Maria ci ritorna e paga, quel pagamento riesce: l'avviso di Stripe trova la
 * riserva già scaduta e rimborsa d'ufficio. Maria si vede addebitare e
 * riaccreditare una somma che aveva già deciso di pagare in contanti, non
 * capisce cosa sia successo e chiama l'assistenza. La commissione fissa che
 * Stripe trattiene sul pagamento rimborsato non torna indietro.
 *
 * Qui la rotta dei contanti si ESEGUE davvero, con un database finto e uno
 * Stripe finto, e si guarda una cosa sola: la pagina di prima risulta chiusa.
 */

/** Le sessioni di pagamento che il codice ha chiuso su Stripe. */
const sessioniChiuse: string[] = [];
/** La merce rimessa in vendita: serve a provare che le due cose vanno insieme. */
const merceRimessaInVendita: unknown[] = [];
/** Gli ordini in contanti creati. */
const ordiniCreati: Array<Record<string, unknown>> = [];

const PANE = '11111111-1111-1111-1111-111111111111';
const FORNO = 'aaaaaaaa-0000-0000-0000-000000000001';

type RigaPending = {
  id: string;
  groups: Array<{ items: Array<{ productId: string; quantity: number; variantId: string | null }> }>;
  coupon_code: string | null;
  stripe_session_id: string | null;
  delivery: { impronta_carrello: string | null } | null;
};

/** Il tentativo con la carta che Maria ha abbandonato un minuto fa. */
function tentativoConLaCarta(): RigaPending {
  return {
    id: 'pending-carta',
    groups: [{ items: [{ productId: PANE, quantity: 1, variantId: null }] }],
    coupon_code: null,
    stripe_session_id: 'cs_test_1',
    delivery: { impronta_carrello: 'carrello-di-prima' },
  };
}

let righePending: RigaPending[] = [];

function risolvibile(valore: unknown) {
  const b: Record<string, unknown> = {
    select: () => b,
    eq: () => b,
    in: () => b,
    insert: () => b,
    update: () => b,
    delete: () => b,
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
    user: { id: 'maria', email: 'maria@test.it', email_confirmed_at: '2026-01-01T00:00:00Z' },
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
vi.mock('@/lib/store-hours', () => ({
  negozioPuoServire: vi.fn(() => true),
  motivoNegozioChiuso: vi.fn((n: string) => `${n} è chiuso in questo momento.`),
}));
vi.mock('@/lib/promotions', () => ({
  fetchActiveDiscounts: vi.fn(async () => new Map()),
  discountedUnitCents: vi.fn((prezzo: number) => Math.round(prezzo * 100)),
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true, id: 'e1' })) }));
vi.mock('@/lib/email/templates', () => ({
  orderConfirmedBuyerTemplate: vi.fn(() => ({ subject: 's', html: 'h' })),
  newOrderSellerTemplate: vi.fn(() => ({ subject: 's', html: 'h' })),
}));
vi.mock('@/lib/analytics/server', () => ({
  contaAcquisto: vi.fn(async () => undefined),
  misuraAttiva: () => true,
  analyticsConsentita: vi.fn(async () => true),
}));

/**
 * Lo Stripe finto. `expire` è la chiamata che rende non più pagabile la scheda
 * aperta: è esattamente quella che mancava.
 */
vi.mock('@/lib/stripe/client', () => ({
  computeOrderSplit: vi.fn(() => ({ applicationFeeCents: 100, sellerPayoutCents: 900 })),
  getStripe: () => ({
    checkout: {
      sessions: {
        expire: async (id: string) => {
          sessioniChiuse.push(id);
          return { id, status: 'expired' };
        },
      },
    },
  }),
}));

vi.mock('@/lib/supabase/server', () => {
  const prodotti = [
    { id: PANE, seller_id: FORNO, name: 'Pane', price: 5, stock: 10, has_variants: false, images: [], status: 'available' },
  ];
  const venditori = [
    { id: FORNO, store_name: 'Forno', store_lat: 45.05, store_lng: 9.69, store_hours: null },
  ];

  /**
   * La tavola dei tentativi di pagamento aperti. Due usi diversi, e vanno
   * distinti: la LETTURA di quelli aperti e la RIVENDICAZIONE (PENDING →
   * EXPIRED) che è quella che libera davvero la merce.
   */
  const pendingCheckouts = () => {
    let idRivendicato: string | null = null;
    let inAggiornamento = false;
    const esito = () => {
      if (!inAggiornamento) return { data: righePending, error: null };
      const trovata = righePending.find((r) => r.id === idRivendicato);
      if (!trovata) return { data: [], error: null };
      righePending = righePending.filter((r) => r.id !== idRivendicato);
      return { data: [{ id: trovata.id }], error: null };
    };
    const b: Record<string, unknown> = {
      select: () => b,
      update: () => { inAggiornamento = true; return b; },
      eq: (colonna: string, valore: unknown) => {
        if (colonna === 'id') idRivendicato = valore as string;
        return b;
      },
      in: () => b,
      limit: () => b,
      then: (res: (v: unknown) => unknown) => res(esito()),
    };
    return b;
  };

  const from = (table: string): Record<string, unknown> => {
    if (table === 'pending_checkouts') return pendingCheckouts();
    if (table === 'products') return risolvibile({ data: prodotti, error: null });
    if (table === 'profiles') return risolvibile({ data: venditori, error: null });
    if (table === 'seller_public_profiles') return risolvibile({ data: venditori, error: null });
    if (table === 'product_variants') return risolvibile({ data: [], error: null });
    if (table === 'orders') {
      return {
        insert: (valori: Record<string, unknown>) => {
          ordiniCreati.push(valori);
          return { select: () => ({ single: () => Promise.resolve({ data: { id: `ord-${ordiniCreati.length}` }, error: null }) }) };
        },
        delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
        // Nessun ordine porta ancora la sessione vecchia: se ce ne fosse uno,
        // la merce NON andrebbe rimessa a scaffale (è merce già venduta).
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
        insert: () => Promise.resolve({ error: null }),
        update: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }), then: (res: (x: unknown) => unknown) => res({ error: null }) }) }),
        delete: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }), then: (res: (x: unknown) => unknown) => res({ error: null }) }) }),
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }), maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
      };
    }
    if (table === 'notifications') return { insert: () => Promise.resolve({ error: null }) };
    return risolvibile({ data: [], error: null });
  };

  const rpc = (name: string, args: Record<string, unknown>) => {
    if (name === 'restore_stock') merceRimessaInVendita.push(args.p_items);
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
      auth: { getUser: async () => ({ data: { user: { id: 'maria', email: 'maria@test.it' } } }) },
      from,
    }),
  };
});

function richiestaContanti(): never {
  return new Request('http://localhost/api/orders/cod', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'maria-passa-ai-contanti' },
    body: JSON.stringify({
      groups: [{ sellerId: FORNO, items: [{ productId: PANE, quantity: 1 }] }],
      delivery: { fullName: 'Maria Rossi', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', phone: '3331234567' },
      pickupInStore: false,
      useCredit: false,
    }),
  }) as never;
}

beforeEach(() => {
  sessioniChiuse.length = 0;
  merceRimessaInVendita.length = 0;
  ordiniCreati.length = 0;
  righePending = [tentativoConLaCarta()];
});

describe('chi passa dalla carta ai contanti non resta con un pagamento aperto', () => {
  it('la scheda di pagamento di prima risulta chiusa, insieme alla merce liberata', async () => {
    const { POST } = await import('@/app/api/orders/cod/route');
    const risposta = await (POST as unknown as (req: never) => Promise<Response>)(richiestaContanti());

    expect(risposta.status, 'l ordine in contanti non e nato').toBe(200);
    expect(ordiniCreati.length, 'nessun ordine in contanti creato').toBe(1);

    // Il cuore: la pagina di Stripe rimasta aperta non deve poter incassare
    // niente. Se resta pagabile, il cliente paga e viene rimborsato.
    expect(
      sessioniChiuse,
      'la pagina di pagamento con la carta e rimasta pagabile: chi ci torna paga e viene rimborsato',
    ).toEqual(['cs_test_1']);

    // Le due cose vanno insieme: se si libera la merce si chiude la pagina.
    expect(merceRimessaInVendita, 'la merce del tentativo con la carta non e tornata a scaffale').toEqual([
      [{ product_id: PANE, variant_id: null, qty: 1 }],
    ]);
  });

  it('senza tentativi aperti non si chiude niente e l ordine passa lo stesso', async () => {
    righePending = [];
    const { POST } = await import('@/app/api/orders/cod/route');
    const risposta = await (POST as unknown as (req: never) => Promise<Response>)(richiestaContanti());

    expect(risposta.status).toBe(200);
    expect(sessioniChiuse, 'chiusa una sessione che non esisteva').toEqual([]);
  });

  it('un tentativo che ha gia degli ordini non si tocca: quella merce e venduta', async () => {
    /**
     * La cautela che viene prima di tutto: se il pagamento con la carta è
     * andato a buon fine a metà (ordini già creati), non si rimette a scaffale
     * merce venduta e non si chiude il pagamento che l'ha pagata.
     */
    const { liberaRiserveAbbandonate } = await import('@/lib/ordini/riserve-abbandonate');
    const chiuse: string[] = [];
    const admin = {
      from: (tavola: string) => {
        if (tavola === 'orders') return risolvibile({ data: [{ stripe_session_id: 'cs_test_1' }], error: null });
        return risolvibile({ data: [tentativoConLaCarta()], error: null });
      },
      rpc: async () => ({ error: null }),
    };

    const esito = await liberaRiserveAbbandonate(admin as never, {
      buyerId: 'maria',
      soloConProdotti: [PANE],
      chiudiSessione: async (id) => { chiuse.push(id); },
    });

    expect(esito.liberati).toEqual([]);
    expect(chiuse, 'chiuso il pagamento di un ordine gia nato').toEqual([]);
  });
});
