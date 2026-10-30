import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * L EMAIL «NUOVO ORDINE» CHE PARTE DAL WEBHOOK DELLA CARTA DICE LA SCADENZA VERA.
 *
 * Il collaudo dell ondata 17: le prove guardavano solo la strada dei contanti. Togliere la fascia
 * (deliverySlot) o la nascita dell ordine (createdAt) passate a newOrderSellerTemplate in
 * lib/stripe/webhook/ordini.ts lasciava tutto verde, e il negozio avrebbe letto «appena puoi».
 *
 * Qui gira handleCheckoutCompleted vero, col modello vero dell email e sendEmail spiato. Esempio
 * della scheda: alle 21:15 un cliente paga con la carta da Pane Quotidiano per «Domani ·
 * 9:00–12:00»; l email al negozio dice «entro le 12:00 di domani».
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
vi.mock('@/lib/email/templates', async (originale) => ({
  ...(await originale<Record<string, unknown>>()),
  orderConfirmedBuyerTemplate: () => ({ subject: 's', html: 'h', text: 't' }),
}));
vi.mock('@/lib/analytics/server', () => ({ analyticsConsentita: async () => true, contaAcquisto: async () => {} }));
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({ paymentIntents: { retrieve: async () => ({ latest_charge: 'ch_1' }) } }),
  computeOrderSplit: () => ({ applicationFeeCents: 100, sellerPayoutCents: 900 }),
}));

const fascia: { slot: string | null } = { slot: null };
const PENDING = () => ({
  id: 'pc_1', buyer_id: 'buyer-1', status: 'PENDING', total_cents: 1800, stripe_session_id: 'cs_1', coupon_code: null,
  pickup_in_store: false,
  delivery: { full_name: 'Maria Rossi', phone: '333', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', notes: null, lat: null, lng: null, slot: fascia.slot },
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

async function paga(ora: string, slot: string) {
  fascia.slot = slot;
  vi.setSystemTime(new Date(ora));
  await handleCheckoutCompleted(sessione);
  for (const lavoro of dopoLaRisposta) await lavoro();
  return spedite.find((m) => m.to === 'pane-quotidiano@negozio.test');
}

describe('l email «Nuovo ordine» dalla strada della carta', () => {
  it('alle 21:15 per «Domani · 9:00–12:00» dice entro le 12:00 di domani, non «appena puoi» né «15 minuti»', async () => {
    const alNegozio = await paga('2026-10-30T20:15:00.000Z', 'Domani · 9:00–12:00');
    expect(alNegozio, 'il negozio non ha ricevuto l email').toBeTruthy();
    expect(alNegozio?.text).toContain('entro le 12:00 di domani');
    expect(alNegozio?.html).toContain('12:00 di domani');
    expect(alNegozio?.text).not.toMatch(/15 minuti|appena puoi/i);
  });

  it('alle 18:05 con la veloce dice entro le 18:15, i 10 minuti del freno', async () => {
    const alNegozio = await paga('2026-10-30T17:05:00.000Z', 'Adesso · arrivo in 30-60 min');
    expect(alNegozio?.text).toContain('entro le 18:15');
  });
});
