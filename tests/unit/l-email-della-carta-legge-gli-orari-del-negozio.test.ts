import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * 30/10/2026 (ondata 24) — L'EMAIL «NUOVO ORDINE» DELLA CARTA LEGGE GLI ORARI DEL NEGOZIO.
 *
 * Il webhook della carta mandava l'email senza gli orari del negozio: lunedì alle 12:00 per «Oggi ·
 * 13:00–16:30» Pane Quotidiano leggeva «entro le 16:30», con l'ultimo ritiro alle 12:45. La prova
 * passa dal webhook vero; gli orari arrivano dalla tabella `profiles` finta, solo se la lettura li chiede.
 */
const { ORARI_PQ } = vi.hoisted(() => {
  const giorno = [['09:00', '13:00'], ['16:30', '19:30']];
  return {
    ORARI_PQ: { mon: giorno, tue: giorno, wed: giorno, thu: [['09:00', '13:00']], fri: giorno, sat: giorno, sun: [] },
  };
});

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
    from: (tabella: string) => tabella === 'profiles' ? ({
      select: (colonne: string) => ({
        eq: () => ({
          maybeSingle: async () => ({ data: /store_hours/.test(colonne) ? { store_hours: ORARI_PQ } : {}, error: null }),
        }),
      }),
    }) : ({
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

describe('l email «Nuovo ordine» della carta dice l’ultimo ritiro, dagli orari del negozio', () => {
  it('caso 1 — lunedì 12:00, «Oggi · 13:00–16:30»: entro le 12:45, non le 16:30', async () => {
    const alNegozio = await paga('2026-11-02T11:00:00.000Z', 'Oggi · 13:00–16:30');
    expect(alNegozio, 'il negozio non ha ricevuto l email').toBeTruthy();
    expect(alNegozio?.text).toContain('entro le 12:45 di oggi');
    expect(alNegozio?.text).not.toContain('entro le 16:30');
  });
});
