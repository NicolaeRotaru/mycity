import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * R28-010 — LA CONFERMA D'ORDINE PAGATO CON LA CARTA DICE QUANDO ARRIVA E COME SI È PAGATO.
 *
 * Nei contanti la conferma al cliente porta la fascia, il ritiro e il modo di pagare
 * (app/api/orders/cod/route.ts). Dalla strada della carta (lib/stripe/webhook/ordini.ts) partiva
 * solo con nome, numero, totale e negozio: il cliente leggeva «Ordine ricevuto» senza sapere quando
 * arriva. Qui gira handleCheckoutCompleted vero, col modello vero dell'email e sendEmail spiato.
 */
const dopoLaRisposta: Array<() => Promise<void>> = [];
vi.mock('next/server', () => ({
  after: (fn: () => Promise<void>) => { dopoLaRisposta.push(fn); },
  NextResponse: { json: (b: unknown, i?: ResponseInit) => new Response(JSON.stringify(b), i) },
}));

const spedite: Array<{ to: string; text?: string; html?: string }> = [];
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({
  sendEmail: async (m: { to: string; text?: string; html?: string }) => { spedite.push(m); return { ok: true }; },
}));
vi.mock('@/lib/analytics/server', () => ({ analyticsConsentita: async () => true, contaAcquisto: async () => {} }));
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({ paymentIntents: { retrieve: async () => ({ latest_charge: 'ch_1' }) } }),
  computeOrderSplit: () => ({ applicationFeeCents: 100, sellerPayoutCents: 900 }),
}));

const caso: { slot: string | null; ritiro: boolean } = { slot: null, ritiro: false };
const PENDING = () => ({
  id: 'pc_1', buyer_id: 'buyer-1', status: 'PENDING', total_cents: 1800, stripe_session_id: 'cs_1', coupon_code: null,
  pickup_in_store: caso.ritiro,
  delivery: { full_name: 'Maria Rossi', phone: '333', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', notes: null, lat: null, lng: null, slot: caso.slot },
  groups: [{
    sellerId: 'pane-quotidiano', storeName: 'Pane Quotidiano', totalCents: 1800, shippingCents: 0, deliveryFeeCents: 300,
    riderFeeCents: 300, couponPortionCents: 0, pickupPortionCents: 0,
    items: [{ productId: 'p1', quantity: 1, unitAmountCents: 1500 }],
  }],
});

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
          single: async () => ({ data: PENDING(), error: null }),
          maybeSingle: async () => ({ data: PENDING(), error: null }),
          then: undefined,
        }),
      }),
      insert: () => ({
        select: () => ({ single: async () => ({ data: { id: 'o1' }, error: null }) }),
        then: (r: (v: { error: null }) => unknown) => r({ error: null }),
      }),
      update: () => ({ eq: async () => ({ error: null }) }),
      delete: () => ({ eq: async () => ({ error: null }) }),
    }),
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: { email: `${id}@negozio.test` } } }) } },
  }),
}));

import { handleCheckoutCompleted } from '@/lib/stripe/webhook/ordini';

const sessione = {
  id: 'cs_1', payment_status: 'paid', client_reference_id: 'pc_1', amount_total: 1800, payment_intent: 'pi_1',
  customer_details: { email: 'cliente@test.it', name: 'Maria Rossi' }, metadata: {},
} as never;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  spedite.length = 0;
  dopoLaRisposta.length = 0;
});
afterEach(() => vi.useRealTimers());

async function paga(ora: string, slot: string | null, ritiro = false) {
  caso.slot = slot;
  caso.ritiro = ritiro;
  vi.setSystemTime(new Date(ora));
  await handleCheckoutCompleted(sessione);
  for (const lavoro of dopoLaRisposta) await lavoro();
  return spedite.find((m) => m.to === 'cliente@test.it');
}

describe('R28-010 · la conferma al cliente dalla strada della carta', () => {
  it('alle 21:15 per «Domani · 9:00–12:00» dice la fascia e che è pagato con la carta', async () => {
    const alCliente = await paga('2026-10-30T20:15:00.000Z', 'Domani · 9:00–12:00');
    expect(alCliente, 'il cliente non ha ricevuto la conferma').toBeTruthy();
    expect(alCliente?.text).toContain('Consegna: Domani · 9:00–12:00');
    expect(alCliente?.html).toContain('Domani · 9:00–12:00');
    expect(alCliente?.text).toContain('Pagato con la carta');
    expect(alCliente?.text).not.toMatch(/contanti/i);
  });

  it('con la veloce alle 18:05 dice «Adesso» nella riga della consegna', async () => {
    const alCliente = await paga('2026-10-30T17:05:00.000Z', 'Adesso · arrivo in 30-60 min');
    expect(alCliente?.text).toMatch(/Consegna: Adesso/);
    expect(alCliente?.text).toContain('Pagato con la carta');
  });

  it('un pagamento rimasto col ritiro in negozio parla di ritiro, non di consegna né di rider', async () => {
    const alCliente = await paga('2026-10-30T09:05:00.000Z', null, true);
    expect(alCliente?.html).toContain('Ritiro in negozio');
    expect(alCliente?.text).not.toMatch(/Consegna:|rider|fattorino/i);
    expect(alCliente?.text).toContain('Pagato con la carta');
  });
});
