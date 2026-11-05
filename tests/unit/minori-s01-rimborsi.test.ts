import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scritturaSuUnaRiga } from './aiuti/scrittura-su-una-riga';

/**
 * S01 — rimborsi con la carta attraverso il refundOrder vero
 * (banco preso da rimborso-carta-non-lo-paga-mycity.test.ts).
 */
type Order = {
  id: string;
  user_id: string;
  total_price: number;
  gross_total_cents: number;
  seller_payout_cents: number;
  seller_payout_reversed_cents: number;
  payout_status: string;
  stripe_payment_intent: string | null;
  stripe_transfer_id: string | null;
  stripe_reversal_id: string | null;
  refunded_amount_cents: number;
  payment_method: string;
};

function baseOrder(): Order {
  return {
    id: 'o1',
    user_id: 'u1',
    total_price: 20,
    gross_total_cents: 2000,
    seller_payout_cents: 1800,
    seller_payout_reversed_cents: 0,
    // Il bonifico NON è ancora partito: è il caso normale, non quello raro.
    payout_status: 'HELD',
    stripe_payment_intent: 'pi_1',
    stripe_transfer_id: null,
    stripe_reversal_id: null,
    refunded_amount_cents: 0,
    payment_method: 'card',
  };
}

const state: {
  order: Order;
  updates: Record<string, unknown>[];
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
  stripeRifiuta: boolean;
} = { order: baseOrder(), updates: [], rpcCalls: [], stripeRifiuta: false };

const refundsCreate = vi.fn(async () => {
  if (state.stripeRifiuta) throw new Error('carta scaduta');
  return { id: 're_x' };
});
const createReversal = vi.fn(async () => ({ id: 'trr_1' }));

vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({ refunds: { create: refundsCreate }, transfers: { createReversal } }),
}));
const avvisi = vi.hoisted(() => ({ titoli: [] as string[], statoCade: false }));
vi.mock('@/lib/stripe/webhook/comune', async (o) => ({
  ...((await o()) as object),
  notifyAdmins: vi.fn(async (t: string) => (avvisi.titoli.push(t), 'scritto')),
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/email/templates', () => ({ refundIssuedTemplate: () => ({ subject: 's', html: 'h', text: 't' }) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (table: string) => {
      if (table === 'orders') {
        return {
          select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: state.order, error: null }) }) }),
          update: (u: Record<string, unknown>) =>
            avvisi.statoCade && 'payment_status' in u
              ? { eq: () => Promise.resolve({ error: { message: 'timeout' } }) }
              : scritturaSuUnaRiga(() => state.order as unknown as Record<string, unknown>, () => {
              state.updates.push(u);
              Object.assign(state.order, u);
            }),
        };
      }
      return {};
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args });
      if (name === 'accumula_rimborso') {
        const totale = state.order.gross_total_cents;
        const nuovo = (state.order.refunded_amount_cents ?? 0) + Number(args.p_delta ?? 0);
        if (nuovo > totale) return Promise.resolve({ data: [], error: null });
        state.order.refunded_amount_cents = nuovo;
        return Promise.resolve({ data: [{ totale_rimborsato: nuovo, totale_ordine: totale }], error: null });
      }
      if (name === 'storna_rimborso') {
        state.order.refunded_amount_cents = Math.max(
          0, (state.order.refunded_amount_cents ?? 0) - Number(args.p_delta ?? 0),
        );
        return Promise.resolve({ data: state.order.refunded_amount_cents, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'b@x.com' } } }) } },
  }),
}));

import { refundOrder } from '@/lib/stripe/payout';


beforeEach(() => {
  state.order = baseOrder();
  state.updates = [];
  state.rpcCalls = [];
  state.stripeRifiuta = false;
  refundsCreate.mockClear();
  createReversal.mockClear();
  avvisi.titoli = [];
  avvisi.statoCade = false;
});

describe('1650 — la nota lunga del negozio non fa fallire il rimborso', () => {
  it('nei metadati di Stripe la nota arriva tagliata a 500 caratteri', async () => {
    await refundOrder({ orderId: 'o1', amountCents: 2000, idempotencyKey: 'return_r1', reason: 'n'.repeat(1000) });
    const arg = (refundsCreate.mock.calls[0] as unknown[])[0] as { metadata: Record<string, string> };
    expect(arg.metadata.reason.length).toBe(500);
    for (const v of Object.values(arg.metadata)) expect(String(v).length).toBeLessThanOrEqual(500);
  });
});

describe('2666 — lo stato dell ordine che non si scrive dopo il rimborso', () => {
  it('avviso agli amministratori, non solo una riga nel log', async () => {
    avvisi.statoCade = true;
    await refundOrder({ orderId: 'o1', amountCents: 2000, idempotencyKey: 'return_r9' });
    expect(refundsCreate).toHaveBeenCalledTimes(1);
    expect(avvisi.titoli.some((t) => t.includes('stato dell ordine non aggiornato'))).toBe(true);
  });
  it('controprova: senza guasto nessun avviso', async () => {
    await refundOrder({ orderId: 'o1', amountCents: 2000, idempotencyKey: 'return_r10' });
    expect(avvisi.titoli.some((t) => t.includes('stato dell ordine non aggiornato'))).toBe(false);
  });
});
