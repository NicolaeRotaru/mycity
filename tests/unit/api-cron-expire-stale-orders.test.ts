import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Cron expire-stale-orders (audit 🟠-16): chiude gli ordini orfani fermi in NEW.
 *
 * Garanzie testate:
 *  - COD orfano → ripristino stock + notifica, nessun rimborso;
 *  - carta pagato → rimborso reale via refundOrder (importo intero);
 *  - idempotenza → se il claim atomico NEW→CANCELED non matcha (già preso da
 *    un'altra esecuzione), NESSUN rimborso/annullo;
 *  - storno del credito wallet speso.
 */

const state: { candidates: Record<string, unknown>[]; claimed: Array<{ id: string }> } = {
  candidates: [],
  claimed: [{ id: 'o1' }],
};
const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
const notifInsert = vi.fn(async () => ({ error: null }));
const refundOrderMock = vi.fn(async (_opts: unknown) => ({ refundId: 're_1', reversedCents: 0 }));

function qb(result: unknown) {
  const chain = () => builder;
  const builder: Record<string, unknown> = {
    select: chain,
    eq: chain,
    lt: chain,
    limit: chain,
    update: chain,
    then: (resolve: (v: unknown) => unknown) => resolve(result),
  };
  return builder;
}

vi.mock('@/lib/api/middleware', () => ({
  withCronAuth: (h: (req: unknown) => unknown) => (req: unknown) => h(req),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/stripe/payout', () => ({ refundOrder: (arg: unknown) => refundOrderMock(arg) }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (table: string) => {
      if (table === 'orders') {
        return {
          select: () => qb({ data: state.candidates, error: null }),
          update: () => qb({ data: state.claimed, error: null }),
        };
      }
      if (table === 'notifications') return { insert: notifInsert };
      return { select: () => qb({ data: [], error: null }) };
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));

async function run() {
  const { POST } = await import('@/app/api/cron/expire-stale-orders/route');
  return (POST as unknown as (req: Request) => Promise<Response>)(
    new Request('http://x', { method: 'POST' }),
  );
}

beforeEach(() => {
  rpcCalls.length = 0;
  refundOrderMock.mockClear();
  notifInsert.mockClear();
  state.candidates = [];
  state.claimed = [{ id: 'o1' }];
});

describe('POST /api/cron/expire-stale-orders', () => {
  it('annulla un COD orfano: ripristina stock + notifica, nessun rimborso', async () => {
    state.candidates = [
      { id: 'o1', user_id: 'u1', payment_method: 'cod', payment_status: 'PENDING', stripe_payment_intent: null, total_price: 20, wallet_applied_cents: 0 },
    ];
    const res = await run();
    expect(await res.json()).toMatchObject({ ok: true, canceled: 1, refunded: 0 });
    expect(refundOrderMock).not.toHaveBeenCalled();
    expect(rpcCalls.some((c) => c.name === 'restore_stock_for_order' && c.args.p_order_id === 'o1')).toBe(true);
    expect(notifInsert).toHaveBeenCalled();
  });

  it('annulla un ordine carta pagato: rimborso intero via refundOrder', async () => {
    state.candidates = [
      { id: 'o1', user_id: 'u1', payment_method: 'card', payment_status: 'PAID', stripe_payment_intent: 'pi_1', total_price: 50, wallet_applied_cents: 0 },
    ];
    const res = await run();
    expect(await res.json()).toMatchObject({ ok: true, canceled: 1, refunded: 1 });
    expect(refundOrderMock).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'o1', amountCents: 5000, notifyBuyer: true }),
    );
    // Sul percorso carta lo stock lo ripristina refundOrder, non il cron.
    expect(rpcCalls.some((c) => c.name === 'restore_stock_for_order')).toBe(false);
  });

  it('idempotente: claim a vuoto (già annullato) → nessun rimborso', async () => {
    state.candidates = [
      { id: 'o1', user_id: 'u1', payment_method: 'card', payment_status: 'PAID', stripe_payment_intent: 'pi_1', total_price: 50, wallet_applied_cents: 0 },
    ];
    state.claimed = []; // un'altra esecuzione ha già preso l'ordine
    const res = await run();
    expect(await res.json()).toMatchObject({ ok: true, canceled: 0, refunded: 0 });
    expect(refundOrderMock).not.toHaveBeenCalled();
  });

  it('storna il credito wallet speso', async () => {
    state.candidates = [
      { id: 'o1', user_id: 'u1', payment_method: 'cod', payment_status: 'PENDING', stripe_payment_intent: null, total_price: 20, wallet_applied_cents: 500 },
    ];
    await run();
    expect(
      rpcCalls.some((c) => c.name === 'wallet_credit' && c.args.p_cents === 500 && c.args.p_user === 'u1'),
    ).toBe(true);
  });
});
