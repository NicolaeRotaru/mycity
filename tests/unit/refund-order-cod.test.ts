import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * refundOrder — percorso COD (🟠-18): nessuna charge Stripe → accredito sul
 * wallet del buyer. Garanzie:
 *  - claw-back del transfer al venditore se il COD era già stato pagato
 *    (TRANSFERRED) — altrimenti doppia uscita;
 *  - NON marca delivery_status='CANCELED' (la consegna è avvenuta, il contante
 *    resta nella riconciliazione del rider);
 *  - idempotente sul ref (unique violation 23505 → no-op).
 */

type Order = {
  id: string;
  user_id: string;
  total_price: number;
  seller_payout_cents: number;
  payout_status: string;
  stripe_payment_intent: string | null;
  stripe_transfer_id: string | null;
  stripe_reversal_id: string | null;
  refunded_amount_cents: number;
  payment_method: string;
};

const state: {
  order: Order;
  walletErr: null | { code?: string; message: string };
  updates: Record<string, unknown>[];
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
} = {
  order: baseOrder(),
  walletErr: null,
  updates: [],
  rpcCalls: [],
};

function baseOrder(): Order {
  return {
    id: 'o1',
    user_id: 'u1',
    total_price: 20,
    seller_payout_cents: 1800,
    payout_status: 'AWAITING_REMITTANCE',
    stripe_payment_intent: null,
    stripe_transfer_id: null,
    stripe_reversal_id: null,
    refunded_amount_cents: 0,
    payment_method: 'cod',
  };
}

const refundsCreate = vi.fn(async () => ({ id: 're_x' }));
const createReversal = vi.fn(async () => ({ id: 'trr_1' }));

// Stripe: refunds.create NON deve essere usato sul COD; createReversal sì, ma
// solo per il claw-back quando il venditore era già pagato.
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({ refunds: { create: refundsCreate }, transfers: { createReversal } }),
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/email/templates', () => ({ refundIssuedTemplate: () => ({ subject: 's', html: 'h', text: 't' }) }));
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
  state.order = baseOrder();
  state.walletErr = null;
  state.updates = [];
  state.rpcCalls = [];
  refundsCreate.mockClear();
  createReversal.mockClear();
});

describe('refundOrder COD → wallet', () => {
  it('rimborso pieno (non ancora pagato al venditore): wallet, REFUNDED, restore stock, niente CANCEL, niente Stripe', async () => {
    const res = await refundOrder({ orderId: 'o1', amountCents: 2000, idempotencyKey: 'return_r1', notifyBuyer: true });

    expect(res.refundId).toBe('wallet:return_r1');
    const wc = state.rpcCalls.find((c) => c.name === 'wallet_credit');
    expect(wc?.args).toMatchObject({ p_user: 'u1', p_cents: 2000, p_reason: 'cod_refund', p_ref: 'return_r1' });
    const upd = state.updates.find((u) => u.payment_status === 'REFUNDED');
    expect(upd).toMatchObject({ payment_status: 'REFUNDED', payout_status: 'REFUNDED' });
    expect(upd?.delivery_status).toBeUndefined(); // la consegna è avvenuta: non si annulla
    expect(state.rpcCalls.some((c) => c.name === 'restore_stock_for_order')).toBe(true);
    expect(refundsCreate).not.toHaveBeenCalled(); // nessun refund Stripe per il COD
    expect(createReversal).not.toHaveBeenCalled(); // niente da stornare (mai pagato)
  });

  it('claw-back: se il venditore era già pagato (TRANSFERRED) storna il transfer e marca REVERSED', async () => {
    state.order = { ...baseOrder(), payout_status: 'TRANSFERRED', stripe_transfer_id: 'tr_1' };
    await refundOrder({ orderId: 'o1', amountCents: 2000, idempotencyKey: 'return_r1' });

    expect(createReversal).toHaveBeenCalledTimes(1);
    expect(state.updates.some((u) => u.payout_status === 'REVERSED')).toBe(true);
    expect(state.rpcCalls.some((c) => c.name === 'wallet_credit')).toBe(true);
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  it('idempotente: unique violation (23505) → no-op, nessun update di payment_status', async () => {
    state.walletErr = { code: '23505', message: 'duplicate' };
    const res = await refundOrder({ orderId: 'o1', amountCents: 2000, idempotencyKey: 'return_r1' });

    expect(res.refundId).toBe('wallet:return_r1');
    expect(state.updates.some((u) => u.payment_status)).toBe(false);
    expect(state.rpcCalls.some((c) => c.name === 'restore_stock_for_order')).toBe(false);
  });

  it('parziale: PARTIALLY_REFUNDED, niente restore stock, niente CANCEL', async () => {
    await refundOrder({ orderId: 'o1', amountCents: 500, idempotencyKey: 'return_r2' });
    const upd = state.updates.find((u) => u.payment_status);
    expect(upd).toMatchObject({ payment_status: 'PARTIALLY_REFUNDED' });
    expect(upd?.delivery_status).toBeUndefined();
    expect(upd?.payout_status).toBeUndefined();
    expect(state.rpcCalls.some((c) => c.name === 'restore_stock_for_order')).toBe(false);
  });
});
