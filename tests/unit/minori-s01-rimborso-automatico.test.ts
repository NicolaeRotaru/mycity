import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fintoDatabase, type FintoDatabase, type Riga } from './aiuti/finto-database-dei-pagamenti';

/**
 * S01 — rimborsi automatici del webhook senza ordine.
 *  · 60 / 2523: col carrello scaduto o col conto che non torna il cliente
 *    rimborsato riceve campanella ed email, una volta sola.
 *  · 70: se la banca respinge quel rimborso, gli amministratori lo sanno.
 * (banco preso da la-merce-del-carrello-che-non-quadra-torna-in-vendita)
 */
const stato = vi.hoisted(() => ({ db: null as unknown as FintoDatabase, email: [] as Array<Record<string, unknown>> }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async (m: Record<string, unknown>) => (stato.email.push(m), { ok: true })) }));
vi.mock('@/lib/analytics/server', () => ({ contaAcquisto: vi.fn(async () => {}), analyticsConsentita: vi.fn(async () => false) }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.db.client }));
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({ refunds: { create: async (_p: unknown, o: { idempotencyKey: string }) => ({ id: `re_${o.idempotencyKey}` }) } }),
  isStripeConfigured: () => true,
  computeOrderSplit: () => ({ subtotalCents: 0, applicationFeeCents: 0, sellerPayoutCents: 0 }),
}));

import { handleCheckoutCompleted } from '@/lib/stripe/webhook/ordini';
import { handleRefundUpdated } from '@/lib/stripe/webhook/rimborsi';

const sessione = {
  id: 'cs_1', payment_status: 'paid', client_reference_id: 'pc_1', payment_intent: 'pi_1', amount_total: 1500, metadata: {},
  customer_details: { email: 'maria@esempio.it' },
} as unknown as Parameters<typeof handleCheckoutCompleted>[0];

function carrello(extra: Riga = {}): Riga {
  return {
    id: 'pc_1', buyer_id: 'maria', status: 'PENDING', coupon_code: null, pickup_in_store: false, total_cents: 2000,
    stripe_session_id: 'cs_1', expires_at: '2999-01-01T00:00:00Z', delivery: {},
    groups: [{ sellerId: 'fornaio', storeName: 'Il fornaio', items: [{ productId: 'p1', variantId: null, quantity: 1, name: 'Pane', unitAmountCents: 1500 }] }],
    ...extra,
  };
}
const campanelle = () => (stato.db.tabelle.notifications ?? []).filter((n) => n.user_id === 'maria');

beforeEach(() => {
  stato.email = [];
  stato.db = fintoDatabase({ pending_checkouts: [carrello()], orders: [], profiles: [{ id: 'admin1', role: 'admin' }], notifications: [] });
});

describe('60 / 2523 — il cliente rimborsato in automatico lo sa', () => {
  it('conto che non torna: campanella ed email al cliente, una volta sola anche se Stripe riconsegna', async () => {
    await handleCheckoutCompleted(sessione);
    await handleCheckoutCompleted(sessione);
    expect(campanelle()).toHaveLength(1);
    expect(stato.email.filter((m) => m.to === 'maria@esempio.it')).toHaveLength(1);
  });
  it('carrello scaduto: campanella ed email al cliente', async () => {
    stato.db.tabelle.pending_checkouts![0].status = 'EXPIRED';
    stato.db.tabelle.pending_checkouts![0].total_cents = 1500;
    await handleCheckoutCompleted(sessione);
    expect(campanelle()).toHaveLength(1);
    expect(stato.email.some((m) => m.to === 'maria@esempio.it')).toBe(true);
  });
});

describe('70 — rimborso automatico respinto dalla banca', () => {
  it('nessun ordine, ma metadati del carrello: avviso agli amministratori', async () => {
    await handleRefundUpdated({
      id: 're_x', status: 'failed', amount: 1500, payment_intent: 'pi_1',
      metadata: { motivo: 'quadratura_fallita', pending_checkout_id: 'pc_1' },
    } as never);
    const avvisi = (stato.db.tabelle.notifications ?? []).filter((n) => n.user_id === 'admin1');
    expect(avvisi.some((n) => String(n.title).includes('respinto'))).toBe(true);
  });
});

describe('1663 — l avviso del rimborso respinto dice cosa è successo al bonifico del negozio', () => {
  const ordine = (payout: string) => ({
    id: 'o1', refunded_amount_cents: 3000, gross_total_cents: 3000, total_price: 30, payment_status: 'REFUNDED',
    payout_status: payout, seller_payout_cents: 2700, seller_payout_reversed_cents: 0, payout_tentativo: 0, stripe_refund_id: null,
  });
  const respinto = { id: 're_r', status: 'failed', amount: 3000, payment_intent: 'pi_1', metadata: { order_id: 'o1' } } as never;
  const avviso = () => String((stato.db.tabelle.notifications ?? []).find((n) => n.user_id === 'admin1')?.body ?? '');
  it('bonifico in corso (PROCESSING): non dice «rimesso in coda», e l importo è in euro all italiana', async () => {
    stato.db.tabelle.orders = [ordine('PROCESSING')];
    await handleRefundUpdated(respinto);
    expect(avviso()).not.toContain('rimesso in coda.');
    expect(avviso()).toMatch(/30,00\s€/u);
  });
  it('bonifico chiuso dal rimborso (REFUNDED): dice «rimesso in coda»', async () => {
    stato.db.tabelle.orders = [ordine('REFUNDED')];
    await handleRefundUpdated(respinto);
    expect(avviso()).toContain('rimesso in coda.');
  });
});
