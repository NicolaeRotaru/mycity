import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 30/8/2026 (R163) — L'ALTRO CAPO DEL FUNNEL, QUELLO CHE PARTE DAL SERVER.
 *
 * Con la carta l'acquisto lo conta il webhook di Stripe, una volta per ORDINE:
 * un carrello da due negozi fa due `order_placed`. L'avvio del checkout invece
 * parte dal browser, uno per carrello. Finche' il `checkout_id` degli acquisti
 * era l'identificativo della riga di intento — un numero che il browser non ha
 * mai visto — i due capi non si potevano ricucire: la conversione della cassa
 * usciva sopra il 100% e non c'era modo di rimetterla a posto dopo.
 *
 * Adesso la chiave nata nel browser viaggia dentro la riga di intento (come
 * gia' fa il gruppo del test A/B) e torna qui, uguale su tutti gli ordini dello
 * stesso carrello.
 */

vi.mock('next/server', () => ({
  after: (fn: () => Promise<void>) => { rimandati.push(fn); },
  NextResponse: { json: (b: unknown, i?: ResponseInit) => new Response(JSON.stringify(b), i) },
}));
const rimandati: Array<() => Promise<void>> = [];

const acquistiContati: Array<{ orderId: string; sellerId: string; checkoutId?: string | null }> = [];

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: async () => ({ ok: true }) }));
vi.mock('@/lib/email/templates', () => ({
  orderConfirmedBuyerTemplate: () => ({ subject: 's', html: 'h', text: 't' }),
  newOrderSellerTemplate: () => ({ subject: 's', html: 'h', text: 't' }),
}));
vi.mock('@/lib/analytics/server', () => ({
  analyticsConsentita: async () => true,
  contaAcquisto: async (a: { orderId: string; sellerId: string; checkoutId?: string | null }) => {
    acquistiContati.push({ orderId: a.orderId, sellerId: a.sellerId, checkoutId: a.checkoutId });
  },
}));
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({ paymentIntents: { retrieve: async () => ({ latest_charge: 'ch_1' }) } }),
  computeOrderSplit: () => ({ applicationFeeCents: 100, sellerPayoutCents: 900 }),
}));

/** La chiave che il browser ha usato per `checkout_started`. */
const CHIAVE_DEL_BROWSER = '7f3c1a90-2b6e-4a11-9a0f-1c2d3e4f5a6b';

const gruppo = (n: number, chiaveCheckout?: string | null) => ({
  sellerId: `seller-${n}`,
  storeName: `Negozio ${n}`,
  totalCents: 1000,
  shippingCents: 0,
  deliveryFeeCents: 0,
  riderFeeCents: 100,
  couponPortionCents: 0,
  pickupPortionCents: 0,
  items: [{ productId: `p${n}`, quantity: 1, unitAmountCents: 1000 }],
  ...(chiaveCheckout !== undefined ? { chiaveCheckout } : {}),
});

let gruppiDelCarrello: unknown[] = [];
let ordiniCreati = 0;

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
          single: async () => ({
            data: {
              id: 'pc_1',
              buyer_id: 'buyer-1',
              status: 'PENDING',
              total_cents: 2000,
              stripe_session_id: 'cs_1',
              coupon_code: null,
              pickup_in_store: false,
              delivery: { full_name: 'Maria Rossi', phone: '333', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', notes: null, lat: null, lng: null, slot: null },
              groups: gruppiDelCarrello,
            },
            error: null,
          }),
          maybeSingle: async () => ({ data: null, error: null }),
          then: undefined,
        }),
      }),
      insert: () => {
        ordiniCreati += 1;
        const esito = { data: { id: `o${ordiniCreati}` }, error: null };
        return {
          select: () => ({ single: async () => esito }),
          then: (r: (v: { error: null }) => unknown) => r({ error: null }),
        };
      },
      update: () => ({ eq: async () => ({ error: null }) }),
      delete: () => ({ eq: async () => ({ error: null }) }),
    }),
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'negozio@test.it' } } }) } },
  }),
}));

import { handleCheckoutCompleted } from '@/lib/stripe/webhook/ordini';

const sessione = {
  id: 'cs_1',
  payment_status: 'paid',
  client_reference_id: 'pc_1',
  amount_total: 2000,
  payment_intent: 'pi_1',
  customer_details: { email: 'cliente@test.it', name: 'Maria Rossi' },
  metadata: {},
} as never;

beforeEach(() => {
  acquistiContati.length = 0;
  rimandati.length = 0;
  ordiniCreati = 0;
});

async function paga(gruppi: unknown[]) {
  gruppiDelCarrello = gruppi;
  await handleCheckoutCompleted(sessione);
  for (const lavoro of rimandati) await lavoro();
}

describe('gli acquisti nati da un carrello pagato con carta', () => {
  it('portano tutti la chiave che il browser aveva usato per l avvio', async () => {
    await paga([gruppo(1, CHIAVE_DEL_BROWSER), gruppo(2, CHIAVE_DEL_BROWSER)]);

    expect(acquistiContati, 'un carrello da due negozi deve contare due acquisti').toHaveLength(2);
    for (const a of acquistiContati) {
      expect(
        a.checkoutId,
        'l acquisto porta un identificativo che il browser non ha mai visto: il funnel resta spezzato',
      ).toBe(CHIAVE_DEL_BROWSER);
    }
  });

  it('e la chiave e una sola per carrello, non una per ordine', async () => {
    await paga([gruppo(1, CHIAVE_DEL_BROWSER), gruppo(2, CHIAVE_DEL_BROWSER)]);
    expect(new Set(acquistiContati.map((a) => a.checkoutId)).size).toBe(1);
    expect(new Set(acquistiContati.map((a) => a.orderId)).size).toBe(2);
  });

  it('senza chiave dal browser si ripiega sulla riga di intento, come prima', async () => {
    // Carrelli creati prima di questa versione: nella riga di intento la chiave
    // non c'e'. Meglio l'identificativo del carrello che niente.
    await paga([gruppo(1), gruppo(2)]);
    for (const a of acquistiContati) expect(a.checkoutId).toBe('pc_1');
  });
});
