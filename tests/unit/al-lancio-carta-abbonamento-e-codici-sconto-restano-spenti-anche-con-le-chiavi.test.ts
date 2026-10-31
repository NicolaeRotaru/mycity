import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 31/10/2026 — AL LANCIO LA CARTA, L'ABBONAMENTO E I CODICI SCONTO RESTANO SPENTI ANCHE CON LE CHIAVI.
 *
 * Scelta di Nicola del 31/10 («accendi solo la carta»): la carta entra nel lancio, ma si accende
 * con un interruttore suo, `CARTA_ACCESA`. Prima «solo contanti» si reggeva sull'assenza della
 * chiave pubblica di Stripe: chi la metteva su Vercel cambiava cassa e frasi senza un avviso.
 * Lo stesso per l'abbonamento da 50 € dei negozi (`ABBONAMENTO_NEGOZI_ACCESO`) e per i codici
 * sconto (`CODICI_SCONTO_IN_CASSA`), che l'interruttore diceva spenti mentre la cassa li accettava
 * ancora — e un codice di MyCity lo pagherebbe il negozio al 90%.
 *
 * Qui si chiamano le rotte VERE con le chiavi Stripe «presenti» (isStripeConfigured → true) e si
 * guarda cosa incassano. `CARTA_ACCESA` resta quello del file vero, tranne dove la prova lo accende
 * per finta per arrivare fino al codice sconto.
 */

const stato = vi.hoisted(() => ({
  carta: undefined as boolean | undefined,
  inseriti: [] as Array<Record<string, unknown>>,
  rpc: [] as string[],
}));

vi.mock('@/lib/funzioni-al-lancio', async (originale) => {
  const vero = (await originale()) as Record<string, unknown>;
  return {
    ...vero,
    get CARTA_ACCESA() {
      return stato.carta ?? vero.CARTA_ACCESA;
    },
  };
});

const PRODOTTO = '11111111-1111-1111-1111-111111111111';
const NEGOZIO = 'aaaaaaaa-0000-0000-0000-000000000001';

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
const validateCoupon = vi.hoisted(() =>
  vi.fn(async () => ({ ok: true, discount: 5, freeShipping: false, coupon: { code: 'MYCITY5' } })),
);
vi.mock('@/lib/coupons', () => ({ validateCoupon }));
const rivendicaIlCodiceSconto = vi.hoisted(() =>
  vi.fn(async () => ({ ok: true, scontoCents: 500, spedizioneGratis: false, codice: 'MYCITY5' })),
);
vi.mock('@/lib/ordini/rivendica-il-codice-sconto', () => ({ rivendicaIlCodiceSconto }));
vi.mock('@/lib/shipping', () => ({ shippingCentsFor: vi.fn(() => 500), compensoRiderCents: vi.fn(() => 250) }));
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
const stripe = vi.hoisted(() => ({
  sessione: vi.fn(async () => ({ id: 'cs_1', url: 'https://stripe.test/cs_1' })),
  getStripe: vi.fn(() => ({
    checkout: { sessions: { create: vi.fn(async () => ({ id: 'cs_2', url: 'https://stripe.test/cs_2' })) } },
    billingPortal: { sessions: { create: vi.fn(async () => ({ url: 'https://stripe.test/portale' })) } },
    customers: { create: vi.fn(async () => ({ id: 'cus_1' })) },
  })),
}));
vi.mock('@/lib/stripe/client', () => ({
  computeOrderSplit: vi.fn(() => ({ applicationFeeCents: 100, sellerPayoutCents: 900 })),
  // Le chiavi Stripe ci sono: è proprio il caso che prima apriva la carta da sé.
  isStripeConfigured: () => true,
  createMultiSellerCheckoutSession: stripe.sessione,
  getStripe: stripe.getStripe,
  RiservaTroppoCorta: class RiservaTroppoCorta extends Error {},
}));
vi.mock('@/lib/analytics/server', () => ({
  contaAcquisto: vi.fn(async () => undefined),
  misuraAttiva: () => true,
  analyticsConsentita: vi.fn(async () => false),
}));

vi.mock('@/lib/supabase/server', () => {
  const prodotti = [
    { id: PRODOTTO, seller_id: NEGOZIO, name: 'Pane', price: 5, stock: 10, has_variants: false, images: [], status: 'available' },
  ];
  const venditori = [{ id: NEGOZIO, store_name: 'Forno', store_lat: 45.05, store_lng: 9.69, store_hours: null }];
  // Una riga sola, per le rotte dell'abbonamento: il negozio approvato, col suo cliente Stripe e il
  // prodotto da sponsorizzare. Così, alla base, quelle rotte arrivano davvero fino a Stripe.
  const rigaSola = (table: string): unknown =>
    table === 'profiles'
      ? { role: 'seller', is_approved: true, stripe_customer_id: 'cus_1', subscription_status: null, email: 'forno@test.it' }
      : table === 'products'
        ? { id: PRODOTTO, seller_id: 'cliente-1', name: 'Pane', status: 'available' }
        : null;
  const catena = (table: string): Record<string, unknown> => {
    const c: Record<string, unknown> = {};
    for (const m of ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is', 'in', 'order', 'limit', 'filter', 'match', 'select', 'insert', 'update', 'upsert']) {
      c[m] = () => c;
    }
    c.single = () => Promise.resolve({ data: rigaSola(table), error: null });
    c.maybeSingle = c.single;
    c.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok, ko);
    return c;
  };
  const letture = (table: string) => ({
    select: () => ({
      in: () => {
        if (table === 'products') return Promise.resolve({ data: prodotti, error: null });
        if (table === 'product_variants') return Promise.resolve({ data: [], error: null });
        return Promise.resolve({ data: venditori, error: null });
      },
      eq: () => catena(table),
    }),
    insert: () => catena(table),
    update: () => catena(table),
  });
  const adminFrom = (table: string): Record<string, unknown> => {
    if (table === 'orders') {
      return {
        insert: (valori: Record<string, unknown>) => {
          stato.inseriti.push(valori);
          return { select: () => ({ single: () => Promise.resolve({ data: { id: `ord-${stato.inseriti.length}` }, error: null }) }) };
        },
        delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    }
    if (table === 'pending_checkouts') {
      return {
        select: () => {
          const b: Record<string, unknown> = {
            eq: () => b, gt: () => b, filter: () => b, order: () => b, limit: () => b,
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          };
          return b;
        },
        insert: () => ({
          select: () => ({
            single: () => Promise.resolve({ data: { id: 'pc_1', expires_at: new Date(Date.now() + 3600_000).toISOString() }, error: null }),
          }),
        }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    }
    if (table === 'consent_log') {
      return { update: () => ({ is: () => ({ in: () => Promise.resolve({ error: null }) }) }) };
    }
    return {
      insert: () => Promise.resolve({ error: null }),
      update: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }),
      delete: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
    };
  };
  const rpc = (name: string) => {
    stato.rpc.push(name);
    if (name === 'claim_coupon') return Promise.resolve({ data: true, error: null });
    if (name === 'wallet_debit') return Promise.resolve({ data: 0, error: null });
    return Promise.resolve({ data: null, error: null });
  };
  return {
    getServerSupabase: async () => ({ from: letture, rpc }),
    getAdminSupabase: () => ({
      from: adminFrom,
      rpc,
      auth: { admin: { getUserById: async (id: string) => ({ data: { user: { id, email: `${id}@test.it` } } }) } },
    }),
  };
});

const corpo = {
  groups: [{ sellerId: NEGOZIO, items: [{ productId: PRODOTTO, quantity: 1 }], shippingCents: 0 }],
  delivery: { fullName: 'Maria Rossi', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', phone: '3331234567' },
  pickupInStore: false,
  useCredit: false,
};

function richiesta(url: string, extra: Record<string, unknown> = {}): never {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...corpo, ...extra }),
  }) as never;
}
type Rotta = (req: never) => Promise<Response>;

beforeEach(() => {
  stato.carta = undefined;
  stato.inseriti.length = 0;
  stato.rpc.length = 0;
  validateCoupon.mockClear();
  rivendicaIlCodiceSconto.mockClear();
  stripe.sessione.mockClear();
  stripe.getStripe.mockClear();
  vi.resetModules();
});
afterEach(() => vi.unstubAllEnvs());

describe('in produzione, oggi, gli interruttori sono spenti', () => {
  it('carta, abbonamento, codici sconto, app, inviti e PostHog: false nel file vero', async () => {
    const veri = await vi.importActual<Record<string, unknown>>('@/lib/funzioni-al-lancio');
    for (const nome of [
      'CARTA_ACCESA',
      'ABBONAMENTO_NEGOZI_ACCESO',
      'CODICI_SCONTO_IN_CASSA',
      'APP_INSTALLABILE_ACCESA',
      'INVITI_E_PUNTI_ACCESI',
      'POSTHOG_ACCESO',
    ]) {
      expect(veri[nome], `${nome} deve essere spento al lancio`).toBe(false);
    }
  });
});

describe('la carta: la chiave pubblica di Stripe non basta più', () => {
  it('con la chiave su Vercel la cassa e la frase restano «solo contanti»', async () => {
    vi.stubEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'pk_live_messa_per_sbaglio');
    const { cartaAlCheckoutDisponibile, frasePagamento, metodiAlCheckout } = await import('@/lib/promesse-pubbliche');
    expect(cartaAlCheckoutDisponibile()).toBe(false);
    expect(metodiAlCheckout()).toEqual(['contanti-alla-consegna']);
    expect(frasePagamento()).toBe('Paghi in contanti alla consegna');
    // Il verso «acceso»: chiave E interruttore, e la carta torna.
    expect(metodiAlCheckout('pk_live_x', true)).toEqual(['carta-adesso', 'contanti-alla-consegna']);
    expect(metodiAlCheckout('', true)).toEqual(['contanti-alla-consegna']);
  });

  it('la rotta della carta rifiuta anche con le chiavi presenti, e non apre nessun pagamento', async () => {
    const { POST } = await import('@/app/api/stripe/checkout/route');
    const res = await (POST as unknown as Rotta)(richiesta('http://localhost/api/stripe/checkout'));
    expect(res.status).toBe(503);
    expect(stripe.sessione).not.toHaveBeenCalled();
    expect(stato.inseriti).toHaveLength(0);
  });

  it('in contanti si ordina come prima', async () => {
    const { POST } = await import('@/app/api/orders/cod/route');
    const res = await (POST as unknown as Rotta)(richiesta('http://localhost/api/orders/cod'));
    expect(res.status, 'l ordine in contanti non è nato: la prova non misura il percorso vero').toBe(200);
    expect(stato.inseriti.length).toBeGreaterThan(0);
  });
});

describe('i codici sconto: spenti vuol dire che la cassa li rifiuta', () => {
  it('in contanti un codice non passa: niente verifica, niente rivendicazione, niente ordine', async () => {
    const { POST } = await import('@/app/api/orders/cod/route');
    const res = await (POST as unknown as Rotta)(richiesta('http://localhost/api/orders/cod', { couponCode: 'MYCITY5' }));
    expect(res.status).toBe(400);
    expect(validateCoupon).not.toHaveBeenCalled();
    expect(stato.rpc).not.toContain('claim_coupon');
    expect(stato.inseriti).toHaveLength(0);
  });

  it('con la carta (accesa per finta) un codice non passa e non si rivendica', async () => {
    stato.carta = true;
    const { POST } = await import('@/app/api/stripe/checkout/route');
    const res = await (POST as unknown as Rotta)(richiesta('http://localhost/api/stripe/checkout', { couponCode: 'MYCITY5' }));
    expect(res.status).toBe(400);
    expect(rivendicaIlCodiceSconto).not.toHaveBeenCalled();
    expect(stripe.sessione).not.toHaveBeenCalled();
  });

  it('la cassa non disegna il campo del codice', () => {
    const src = senzaCommenti(readFileSync(join(process.cwd(), 'app/checkout/page.tsx'), 'utf8'));
    expect(src).toMatch(/\{CODICI_SCONTO_IN_CASSA && \(\s*<CouponInput/);
    expect(src).toMatch(/CODICI_SCONTO_IN_CASSA && bozza\.couponCode/);
  });
});

describe("l'abbonamento da 50 € e le sponsorizzate: sospesi anche con le chiavi Stripe", () => {
  const rotte: Array<[string, () => Promise<unknown>]> = [
    ['abbonamento', () => import('@/app/api/seller/subscription/checkout/route')],
    ['portale abbonamento', () => import('@/app/api/seller/subscription/portal/route')],
    ['sponsorizzata', () => import('@/app/api/sponsored/checkout/route')],
  ];
  for (const [nome, carica] of rotte) {
    it(`${nome}: 503 e Stripe non viene chiamato`, async () => {
      const { POST } = (await carica()) as { POST: Rotta };
      const res = await POST(
        new Request('http://localhost/x', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ productId: PRODOTTO, weeks: 1 }),
        }) as never,
      );
      expect(res.status).toBe(503);
      expect(stripe.getStripe).not.toHaveBeenCalled();
    });
  }
});

describe("l'app installabile: niente manifest né banner", () => {
  it('il layout li condiziona all interruttore', () => {
    const src = senzaCommenti(readFileSync(join(process.cwd(), 'app/layout.tsx'), 'utf8'));
    expect(src).not.toMatch(/^\s*manifest:\s*'\/manifest\.json',/m);
    expect(src).toMatch(/APP_INSTALLABILE_ACCESA \? \{ manifest: '\/manifest\.json' \}/);
    expect(src).toMatch(/\{APP_INSTALLABILE_ACCESA && <PWAInstallBanner \/>\}/);
  });
});

function senzaCommenti(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');
}
