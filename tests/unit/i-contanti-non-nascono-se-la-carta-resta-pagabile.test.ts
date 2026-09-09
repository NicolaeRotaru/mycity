import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ordineInContantiPuoNascere } from '@/lib/ordini/ordine-in-contanti-puo-nascere';

/**
 * LO STESSO ORDINE NON DEVE POTERSI PAGARE DUE VOLTE.
 *
 * ── Il percorso vero ────────────────────────────────────────────────────────
 * Maria preme «Paga con carta» sull'ultima torta: il server le mette da parte
 * la merce e le apre la pagina di Stripe in una linguetta. Ci ripensa, torna
 * sul sito e sceglie «pago alla consegna». L'ordine in contanti nasce e la
 * torta le viene riassegnata — ma la pagina di Stripe è ancora lì, e resta
 * pagabile fino alla fine della riserva: due ore. Se Maria ci rientra, la carta
 * viene addebitata per una torta che ha già comprato in contanti. L'avviso di
 * Stripe trova la riserva scaduta e rimborsa d'ufficio: soldi usciti e
 * rientrati dopo giorni, e una telefonata all'assistenza.
 *
 * ── Perché non basta «chiudere la pagina» ───────────────────────────────────
 * Chiudere la pagina su Stripe è un'AZIONE, e un'azione può fallire: rete,
 * chiamata rifiutata, oppure — il caso peggiore — la pagina è appena stata
 * PAGATA e non si può più chiudere. Finché quel fallimento restava un avviso
 * nel registro, l'ordine in contanti nasceva lo stesso.
 *
 * ── Il cancello ─────────────────────────────────────────────────────────────
 * Adesso la regola sta su una funzione a parte e sui dati, non sulla strada:
 * se anche una sola pagina è rimasta pagabile, l'ordine in contanti NON nasce e
 * della riserva vecchia non si tocca niente. Qui la si esegue a tre livelli:
 * la regola da sola, la liberazione delle riserve, e la rotta vera.
 */

const PANE = '11111111-1111-1111-1111-111111111111';
const FORNO = 'aaaaaaaa-0000-0000-0000-000000000001';

/** Le sessioni che il codice ha PROVATO a chiudere su Stripe. */
const tentativiDiChiusura: string[] = [];
/** La merce rimessa in vendita: qui non deve muoversi niente. */
const merceRimessaInVendita: unknown[] = [];
/** Gli ordini in contanti creati: qui deve restare vuoto. */
const ordiniCreati: Array<Record<string, unknown>> = [];
/** Le righe passate a EXPIRED: la riserva vecchia non va rivendicata. */
const righeScadute: string[] = [];

type RigaPending = {
  id: string;
  groups: Array<{ items: Array<{ productId: string; quantity: number; variantId: string | null }> }>;
  coupon_code: string | null;
  stripe_session_id: string | null;
  delivery: { impronta_carrello: string | null } | null;
};

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
 * Lo Stripe finto che NON riesce a chiudere. È quello che succede quando la
 * pagina è appena stata pagata: Stripe risponde «si può far scadere solo una
 * sessione ancora aperta».
 */
vi.mock('@/lib/stripe/client', () => ({
  computeOrderSplit: vi.fn(() => ({ applicationFeeCents: 100, sellerPayoutCents: 900 })),
  getStripe: () => ({
    checkout: {
      sessions: {
        expire: async (id: string) => {
          tentativiDiChiusura.push(id);
          throw new Error('You may only expire a Session with an `open` status.');
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

  const pendingCheckouts = () => {
    let idRivendicato: string | null = null;
    let inAggiornamento = false;
    const esito = () => {
      if (!inAggiornamento) return { data: righePending, error: null };
      const trovata = righePending.find((r) => r.id === idRivendicato);
      if (!trovata) return { data: [], error: null };
      righeScadute.push(trovata.id);
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
  tentativiDiChiusura.length = 0;
  merceRimessaInVendita.length = 0;
  ordiniCreati.length = 0;
  righeScadute.length = 0;
  righePending = [tentativoConLaCarta()];
});

describe('la regola, da sola', () => {
  it('una sola pagina rimasta pagabile ferma l ordine in contanti', () => {
    const esito = ordineInContantiPuoNascere({ liberati: ['p1'], ancoraPagabili: ['cs_test_1'] });
    expect(esito.puoNascere, 'l ordine in contanti nasce accanto a una carta ancora pagabile').toBe(false);
    if (esito.puoNascere) return;
    expect(esito.sessioni).toEqual(['cs_test_1']);
    expect(esito.motivo.length, 'chi compra non legge nessuna spiegazione').toBeGreaterThan(20);
  });

  it('se non e rimasto niente di pagabile, l ordine passa', () => {
    expect(ordineInContantiPuoNascere({ liberati: ['p1'], ancoraPagabili: [] }).puoNascere).toBe(true);
    expect(ordineInContantiPuoNascere({ liberati: [], ancoraPagabili: [] }).puoNascere).toBe(true);
  });
});

describe('se la pagina di pagamento non si riesce a chiudere', () => {
  it('della riserva vecchia non si tocca niente, e la sessione viene segnalata', async () => {
    const { liberaRiserveAbbandonate } = await import('@/lib/ordini/riserve-abbandonate');
    const rpcChiamate: string[] = [];
    const admin = {
      from: (tavola: string) => {
        if (tavola === 'orders') return risolvibile({ data: [], error: null });
        return risolvibile({ data: [tentativoConLaCarta()], error: null });
      },
      rpc: async (nome: string) => { rpcChiamate.push(nome); return { error: null }; },
    };

    const esito = await liberaRiserveAbbandonate(admin as never, {
      buyerId: 'maria',
      soloConProdotti: [PANE],
      chiudiSessione: async () => { throw new Error('Stripe non raggiungibile'); },
    });

    expect(esito.ancoraPagabili, 'la pagina rimasta pagabile non viene segnalata a chi ha chiamato').toEqual(['cs_test_1']);
    expect(esito.liberati, 'liberata una riserva la cui pagina e ancora pagabile').toEqual([]);
    expect(
      rpcChiamate,
      'la merce e tornata a scaffale mentre la carta puo ancora pagarla: e il doppio pagamento',
    ).not.toContain('restore_stock');
  });
});

describe('la rotta dei contanti, per intero', () => {
  it('rifiuta l ordine invece di affiancarlo a una carta ancora pagabile', async () => {
    const { POST } = await import('@/app/api/orders/cod/route');
    const risposta = await (POST as unknown as (req: never) => Promise<Response>)(richiestaContanti());

    expect(
      tentativiDiChiusura,
      'la rotta non ha nemmeno provato a chiudere la pagina di pagamento',
    ).toEqual(['cs_test_1']);

    // Il cuore: due porte aperte sullo stesso acquisto non devono esistere.
    expect(
      ordiniCreati,
      'e nato un ordine in contanti mentre la pagina con la carta era ancora pagabile: si paga due volte',
    ).toEqual([]);
    expect(risposta.status, 'la rotta ha risposto come se fosse tutto a posto').toBe(409);

    const corpo = await risposta.json() as { ok: boolean; error?: { code?: string; message?: string } };
    expect(corpo.ok).toBe(false);
    expect(corpo.error?.message ?? '', 'chi compra non capisce cosa fare').toMatch(/riprova/i);

    // Lo stato resta com'era: la riserva vecchia è ancora in piedi, quindi il
    // secondo tentativo riprova da capo invece di trovare via libera.
    expect(righeScadute, 'la riserva e stata rivendicata lo stesso').toEqual([]);
    expect(merceRimessaInVendita, 'la merce e tornata a scaffale lo stesso').toEqual([]);
  });
});
