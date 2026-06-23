import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * release-payouts — pass COD (🔴-1 slice 3). Invariante chiave "paga dopo
 * rimessa": un ordine COD viene pagato al venditore SOLO quando è in 'HELD'
 * (cioè dopo che l'admin ha confermato la rimessa del rider, AWAITING_REMITTANCE
 * → HELD). Un COD ancora in AWAITING_REMITTANCE NON deve essere pagato.
 */

type OrderRow = {
  id: string;
  payment_method: string;
  payout_status: string;
  delivery_status: string;
  dispute_status?: string | null;
};
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
  const ors: string[] = [];
  // Eleggibilità chargeback (audit 🟠-6): replica la semantica dei filtri reali.
  // .is('dispute_status', null) → solo righe null; .or('...is.null,...eq.WON') → null o WON.
  const disputeOk = (o: OrderRow): boolean => {
    if (f['isnull:dispute_status']) return o.dispute_status == null;
    const expr = ors.find((e) => e.includes('dispute_status'));
    if (expr) {
      const allowNull = expr.includes('dispute_status.is.null');
      const allowWon = expr.includes('dispute_status.eq.WON');
      return (allowNull && o.dispute_status == null) || (allowWon && o.dispute_status === 'WON');
    }
    return true;
  };
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (c: string, v: unknown) => ((f[c] = v), b),
    in: (c: string, v: unknown[]) => ((f[`in:${c}`] = v), b),
    is: (c: string, v: unknown) => (v === null ? (f[`isnull:${c}`] = true) : null, b),
    not: () => b,
    or: (expr: string) => (ors.push(expr), b),
    lte: () => b,
    limit: () => b,
    then: (resolve: (x: unknown) => unknown) => {
      const out = rows.filter(
        (o) =>
          (f.payment_method === undefined || o.payment_method === f.payment_method) &&
          (f.payout_status === undefined || o.payout_status === f.payout_status) &&
          (f.delivery_status === undefined || o.delivery_status === f.delivery_status) &&
          (f['in:payout_status'] === undefined || (f['in:payout_status'] as string[]).includes(o.payout_status)) &&
          disputeOk(o),
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

describe('release-payouts — chargeback (audit 🟠-6)', () => {
  it('[🟠-6] paga il venditore card con chargeback VINTO (dispute_status=WON)', async () => {
    state.orders = [
      { id: 'won1', payment_method: 'card', payout_status: 'HELD', delivery_status: 'DELIVERED', dispute_status: 'WON' },
    ];
    const res = await run();
    // Col codice vecchio (.is('dispute_status', null)) sarebbe escluso → released=0.
    expect((await res.json()).released).toBe(1);
    expect(releaseOrderPayoutMock).toHaveBeenCalledWith('won1');
  });

  it('[🟠-6] NON paga un ordine con chargeback APERTO (dispute_status=OPEN)', async () => {
    state.orders = [
      { id: 'open1', payment_method: 'card', payout_status: 'HELD', delivery_status: 'DELIVERED', dispute_status: 'OPEN' },
    ];
    const res = await run();
    expect((await res.json()).released).toBe(0);
    expect(releaseOrderPayoutMock).not.toHaveBeenCalledWith('open1');
  });

  it('[🟠-6] paga normalmente un ordine senza chargeback (dispute_status=null)', async () => {
    state.orders = [
      { id: 'ok1', payment_method: 'card', payout_status: 'HELD', delivery_status: 'DELIVERED', dispute_status: null },
    ];
    const res = await run();
    expect((await res.json()).released).toBe(1);
    expect(releaseOrderPayoutMock).toHaveBeenCalledWith('ok1');
  });
});
