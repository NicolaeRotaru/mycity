import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Webhook Stripe — handler comportamentale charge.dispute.closed (audit 🔴-3).
 * won  → ordini flaggati dispute_status='WON' (tornano eleggibili al payout, vedi 🟠-6)
 * lost → ordini CANCELED + payment_status REFUNDED (i fondi sono già stati prelevati)
 */

process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

const state: { disputeStatus: 'won' | 'lost'; orderUpdate: Record<string, unknown> | null } = {
  disputeStatus: 'won',
  orderUpdate: null,
};

function event() {
  return {
    id: `evt_${state.disputeStatus}`,
    type: 'charge.dispute.closed',
    data: { object: { id: 'dp_1', status: state.disputeStatus, payment_intent: 'pi_1', charge: 'ch_1' } },
  };
}

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({ webhooks: { constructEvent: () => event() } }),
  computeApplicationFeeCents: (c: number) => Math.round((c * 1000) / 10000),
  computeSellerPayoutCents: () => 0,
  computeOrderSplit: (a: { totalCents: number; deliveryFeeCents: number; shippingCents: number }) => {
    const subtotalCents = Math.max(0, a.totalCents - a.deliveryFeeCents - a.shippingCents);
    const applicationFeeCents = Math.round((subtotalCents * 1000) / 10000);
    return { subtotalCents, applicationFeeCents, sellerPayoutCents: Math.max(0, subtotalCents - applicationFeeCents) };
  },
  isStripeConfigured: () => true,
}));
vi.mock('@/lib/stripe/payout', () => ({
  reverseOrderTransfer: vi.fn(),
  applyConnectAccountStatus: vi.fn(),
  refundOrder: vi.fn(),
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({})) }));

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: vi.fn(() => ({
    rpc: () => Promise.resolve({ data: null, error: null }),
    from: (table: string) => {
      if (table === 'stripe_event_log') {
        return {
          insert: () => Promise.resolve({ error: null }),
          select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { processed: false } }) }) }),
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        };
      }
      if (table === 'orders') {
        return {
          // findOrdersForDispute: select(cols).eq('stripe_payment_intent', pi) → {data}
          select: () => ({ eq: () => Promise.resolve({ data: [{ id: 'o1', payout_status: 'HELD' }], error: null }) }),
          // handleDisputeClosed: update(payload).in('id', ids)
          update: (payload: Record<string, unknown>) => {
            state.orderUpdate = payload;
            return { in: () => Promise.resolve({ error: null }) };
          },
        };
      }
      if (table === 'profiles') {
        return { select: () => ({ eq: () => Promise.resolve({ data: [{ id: 'admin1' }], error: null }) }) };
      }
      // notifications
      return { insert: () => Promise.resolve({ error: null }) };
    },
  })),
}));

import { POST } from '@/app/api/stripe/webhook/route';

function makeReq(): never {
  return new Request('http://localhost/api/stripe/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=ok' },
    body: '{}',
  }) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.orderUpdate = null;
});

describe('webhook charge.dispute.closed (audit 🔴-3)', () => {
  it('won → flagga dispute_status=WON (payout sbloccabile)', async () => {
    state.disputeStatus = 'won';
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    expect(state.orderUpdate).toMatchObject({ dispute_status: 'WON' });
    // non deve cancellare/rimborsare un ordine vinto
    expect(state.orderUpdate).not.toHaveProperty('payment_status', 'REFUNDED');
  });

  it('lost → ordine CANCELED + payment_status REFUNDED', async () => {
    state.disputeStatus = 'lost';
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    expect(state.orderUpdate).toMatchObject({
      dispute_status: 'LOST',
      delivery_status: 'CANCELED',
      payment_status: 'REFUNDED',
    });
  });
});
