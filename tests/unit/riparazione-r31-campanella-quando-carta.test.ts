import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FASCE_DI_DOMANI } from '@/lib/quando-arriva';

/**
 * R31-025 (strada della carta) — La campanella «Nuovo ordine» del negozio non diceva per quando va
 * consegnato: la fascia la portava solo l'email. La push del telefono nasce dalla riga della
 * campanella (app/api/cron/send-push la legge da `notifications`), quindi il fornaio sapeva di avere
 * un ordine ma non se era per le 12 o per domani, finché non apriva l'ordine o l'email.
 *
 * Qui gira il webhook vero (`handleCheckoutCompleted`) su un carrello pagato con la fascia di domani:
 * la campanella al negozio deve dire «Consegna: <la fascia>», con le stesse parole dell'email.
 * Banco preso da la-campanella-del-negozio-non-si-perde: database e servizi finti.
 */

const campanelle: Array<Record<string, unknown>> = [];

vi.mock('next/server', () => ({
  after: () => undefined,
  NextResponse: { json: (b: unknown, i?: ResponseInit) => new Response(JSON.stringify(b), i) },
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: async () => ({ ok: true }) }));
vi.mock('@/lib/email/templates', () => ({
  orderConfirmedBuyerTemplate: () => ({ subject: 's', html: 'h', text: 't' }),
  newOrderSellerTemplate: () => ({ subject: 's', html: 'h', text: 't' }),
}));
vi.mock('@/lib/analytics/server', () => ({ analyticsConsentita: async () => true, contaAcquisto: async () => undefined }));
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({ paymentIntents: { retrieve: async () => ({ latest_charge: 'ch_1' }) } }),
  computeOrderSplit: () => ({ applicationFeeCents: 100, sellerPayoutCents: 900 }),
}));

const carrello = vi.hoisted(() => ({ slot: null as string | null, ritiro: false }));

vi.mock('@/lib/supabase/server', () => {
  const pending = () => ({
    id: 'pc_1',
    buyer_id: 'buyer-1',
    status: 'PENDING',
    total_cents: 1000,
    stripe_session_id: 'cs_1',
    coupon_code: null,
    pickup_in_store: carrello.ritiro,
    delivery: { full_name: 'Maria Rossi', phone: '333', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', notes: null, lat: null, lng: null, slot: carrello.slot },
    groups: [{ sellerId: 'seller-1', storeName: 'Pane Quotidiano', totalCents: 1000, shippingCents: 0, deliveryFeeCents: 0, riderFeeCents: 100, couponPortionCents: 0, pickupPortionCents: 0, items: [{ productId: 'p1', quantity: 2, unitAmountCents: 500 }] }],
  });
  return {
    getAdminSupabase: () => ({
      from: (tabella: string) => ({
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
            single: async () => ({ data: pending(), error: null }),
            maybeSingle: async () => ({ data: tabella === 'pending_checkouts' ? pending() : null, error: null }),
            then: undefined,
          }),
        }),
        insert: (righe: unknown) => {
          if (tabella === 'notifications') campanelle.push(...(Array.isArray(righe) ? righe : [righe]) as Array<Record<string, unknown>>);
          const esito = { data: { id: 'o1' }, error: null };
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
  };
});

import { handleCheckoutCompleted } from '@/lib/stripe/webhook/ordini';

const sessione = {
  id: 'cs_1',
  payment_status: 'paid',
  client_reference_id: 'pc_1',
  amount_total: 1000,
  payment_intent: 'pi_1',
  customer_details: { email: 'cliente@test.it', name: 'Maria Rossi' },
  metadata: {},
} as never;

const alNegozio = () => campanelle.filter((c) => c.user_id === 'seller-1');

beforeEach(() => {
  // Martedì 17/11/2026 alle 10:00 di Piacenza: la fascia di domani si può ancora tenere.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-17T09:00:00Z'));
  campanelle.length = 0;
  carrello.slot = null;
  carrello.ritiro = false;
});
afterEach(() => vi.useRealTimers());

describe('R31-025 · carta: la campanella «Nuovo ordine» dice per quando va consegnato', () => {
  it('con la fascia di domani la campanella al negozio la scrive, come l’email', async () => {
    carrello.slot = FASCE_DI_DOMANI[0];
    await handleCheckoutCompleted(sessione);
    expect(alNegozio(), 'nessuna campanella al negozio').toHaveLength(1);
    const corpo = String(alNegozio()[0].body);
    expect(corpo).toContain(`Consegna: ${FASCE_DI_DOMANI[0]}`);
    // Il resto della riga resta com'era: numero, cifra e articoli.
    expect(corpo).toMatch(/^Ordine #\S+ · .+ · 2 articoli/);
  });

  it('senza fascia (ritiro o carrello vecchio) la campanella non inventa un orario', async () => {
    await handleCheckoutCompleted(sessione);
    expect(alNegozio()).toHaveLength(1);
    expect(String(alNegozio()[0].body)).not.toContain('Consegna:');
  });
});
