import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * release-payouts — pass COD (🔴-1 slice 3). Invariante chiave "paga dopo
 * rimessa": un ordine COD viene pagato al venditore SOLO quando è in 'HELD'
 * (cioè dopo che l'admin ha confermato la rimessa del rider, AWAITING_REMITTANCE
 * → HELD). Un COD ancora in AWAITING_REMITTANCE NON deve essere pagato.
 */

type OrderRow = { id: string; payment_method: string; payout_status: string; delivery_status: string };
const state: { orders: OrderRow[] } = { orders: [] };
const releaseOrderPayoutMock = vi.fn(async (_id: string) => ({ ok: true as const, transferId: 'tr_1' }));
const releaseRiderPayoutMock = vi.fn(async (_id: string) => ({ ok: false as const, code: 'BAD_STATE' as const, reason: 'x' }));

vi.mock('@/lib/api/middleware', () => ({
  withCronAuth: (h: (req: unknown) => unknown) => (req: unknown) => h(req),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/stripe/client', () => ({ isStripeConfigured: () => true }));
vi.mock('@/lib/stripe/payout', () => ({
  releaseOrderPayout: (id: string) => releaseOrderPayoutMock(id),
  releaseRiderPayout: (id: string) => releaseRiderPayoutMock(id),
}));

// Builder che rispetta i filtri eq/in rilevanti (payment_method, payout_status,
// delivery_status), così i tre pass (card-seller, rider, COD) vedono il subset giusto.
function ordersBuilder(rows: OrderRow[]) {
  const f: Record<string, unknown> = {};
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (c: string, v: unknown) => ((f[c] = v), b),
    in: (c: string, v: unknown[]) => ((f[`in:${c}`] = v), b),
    is: () => b,
    not: () => b,
    or: () => b,
    lte: () => b,
    limit: () => b,
    then: (resolve: (x: unknown) => unknown) => {
      const out = rows.filter(
        (o) =>
          (f.payment_method === undefined || o.payment_method === f.payment_method) &&
          (f.payout_status === undefined || o.payout_status === f.payout_status) &&
          (f.delivery_status === undefined || o.delivery_status === f.delivery_status) &&
          (f['in:payout_status'] === undefined || (f['in:payout_status'] as string[]).includes(o.payout_status)),
      );
      return resolve({ data: out.map((o) => ({ id: o.id })), error: null });
    },
  };
  return b;
}

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (table: string) => {
      if (table === 'orders') return ordersBuilder(state.orders);
      // returns / disputes: nessun blocco
      return { select: () => ({ in: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) }) };
    },
  }),
}));

async function run() {
  const { POST } = await import('@/app/api/cron/release-payouts/route');
  return (POST as unknown as (req: Request) => Promise<Response>)(new Request('http://x', { method: 'POST' }));
}

beforeEach(() => {
  state.orders = [];
  releaseOrderPayoutMock.mockClear();
  releaseRiderPayoutMock.mockClear();
});

describe('release-payouts pass COD', () => {
  it('paga il venditore per un ordine COD in HELD (rimessa confermata)', async () => {
    state.orders = [{ id: 'cod1', payment_method: 'cod', payout_status: 'HELD', delivery_status: 'DELIVERED' }];
    const res = await run();
    expect(await res.json()).toMatchObject({ ok: true, codReleased: 1 });
    expect(releaseOrderPayoutMock).toHaveBeenCalledWith('cod1');
  });

  it('NON paga un COD ancora in AWAITING_REMITTANCE (gate rimessa)', async () => {
    state.orders = [
      { id: 'cod2', payment_method: 'cod', payout_status: 'AWAITING_REMITTANCE', delivery_status: 'DELIVERED' },
    ];
    const res = await run();
    expect((await res.json()).codReleased).toBe(0);
    expect(releaseOrderPayoutMock).not.toHaveBeenCalled();
  });
});
