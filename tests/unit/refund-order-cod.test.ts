import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * refundOrder — percorso COD (🟠-18): nessuna charge Stripe → accredito sul
 * wallet del buyer, marcatura ordine, ripristino stock. Idempotente: un secondo
 * tentativo con lo stesso ref (unique violation 23505) è un no-op.
 */

type Order = {
  id: string;
  user_id: string;
  total_price: number;
  seller_payout_cents: number;
  payout_status: string;
  stripe_payment_intent: string | null;
  refunded_amount_cents: number;
  payment_method: string;
};

const state: {
  order: Order;
  walletErr: null | { code?: string; message: string };
  updates: Record<string, unknown>[];
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
} = {
  order: {
    id: 'o1',
    user_id: 'u1',
    total_price: 20,
    seller_payout_cents: 1800,
    payout_status: 'AWAITING_REMITTANCE',
    stripe_payment_intent: null,
    refunded_amount_cents: 0,
    payment_method: 'cod',
  },
  walletErr: null,
  updates: [],
  rpcCalls: [],
};

// Stripe NON deve essere usato sul percorso COD.
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => {
    throw new Error('getStripe non deve essere chiamato per un rimborso COD');
  },
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/email/templates', () => ({
  refundIssuedTemplate: () => ({ subject: 's', html: 'h', text: 't' }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (table: string) => {
      if (table === 'orders') {
        return {
          select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: state.order, error: null }) }) }),
          update: (u: Record<string, unknown>) => ({
            eq: () => {
              state.updates.push(u);
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      return {};
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args });
      return Promise.resolve({ data: null, error: name === 'wallet_credit' ? state.walletErr : null });
    },
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'b@x.com' } } }) } },
  }),
}));

import { refundOrder } from '@/lib/stripe/payout';

beforeEach(() => {
  state.order = {
    id: 'o1',
    user_id: 'u1',
    total_price: 20,
    seller_payout_cents: 1800,
    payout_status: 'AWAITING_REMITTANCE',
    stripe_payment_intent: null,
    refunded_amount_cents: 0,
    payment_method: 'cod',
  };
  state.walletErr = null;
  state.updates = [];
  state.rpcCalls = [];
});

describe('refundOrder COD → wallet', () => {
  it('accredita il wallet, marca REFUNDED e ripristina lo stock (rimborso pieno)', async () => {
    const res = await refundOrder({ orderId: 'o1', amountCents: 2000, idempotencyKey: 'return_r1', notifyBuyer: true });

    expect(res.refundId).toBe('wallet:return_r1');
    const wc = state.rpcCalls.find((c) => c.name === 'wallet_credit');
    expect(wc?.args).toMatchObject({ p_user: 'u1', p_cents: 2000, p_reason: 'cod_refund', p_ref: 'return_r1' });
    expect(state.updates[0]).toMatchObject({ payment_status: 'REFUNDED', delivery_status: 'CANCELED' });
    expect(state.rpcCalls.some((c) => c.name === 'restore_stock_for_order')).toBe(true);
  });

  it('idempotente: unique violation (23505) → no-op, nessun update ordine', async () => {
    state.walletErr = { code: '23505', message: 'duplicate' };
    const res = await refundOrder({ orderId: 'o1', amountCents: 2000, idempotencyKey: 'return_r1' });

    expect(res.refundId).toBe('wallet:return_r1');
    expect(state.updates).toHaveLength(0);
    expect(state.rpcCalls.some((c) => c.name === 'restore_stock_for_order')).toBe(false);
  });

  it('parziale: marca PARTIALLY_REFUNDED, niente ripristino stock', async () => {
    const res = await refundOrder({ orderId: 'o1', amountCents: 500, idempotencyKey: 'return_r2' });
    expect(res.refundId).toBe('wallet:return_r2');
    expect(state.updates[0]).toMatchObject({ payment_status: 'PARTIALLY_REFUNDED' });
    expect(state.updates[0].delivery_status).toBeUndefined();
    expect(state.rpcCalls.some((c) => c.name === 'restore_stock_for_order')).toBe(false);
  });
});
