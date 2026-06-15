import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * /api/rider/cash-confirm — guard atomico contro la "doppia cassa".
 *
 * La conferma incasso COD deve essere idempotente sotto concorrenza: due
 * richieste simultanee non possono entrambe scrivere cash_collected_cents.
 * Il meccanismo è l'UPDATE condizionato `.is('cash_confirmed_at', null)`: se la
 * riga è già stata confermata, l'update non matcha (0 righe) e la seconda
 * richiesta riceve 409. Questo test simula proprio quella corsa: la prima lettura
 * vede cash_confirmed_at = null (finestra TOCTOU) ma l'update atomico ritorna 0
 * righe → 409. Senza il guard la route risponderebbe 200 e sovrascriverebbe.
 *
 * Supabase (server + admin) è mockato; ApiErrors e zod sono reali.
 */

const ORDER_ID = '11111111-1111-1111-1111-111111111111';

const state: {
  user: { id: string };
  order: Record<string, unknown> | null;
  claimed: Array<{ id: string }>;
  reconRows: Array<Record<string, unknown>>;
} = {
  user: { id: 'rider-1' },
  order: null,
  claimed: [],
  reconRows: [],
};

// Query-builder chainabile e "awaitable" che risolve sempre a `result`.
function qb(result: unknown) {
  const chain = () => builder;
  const builder: Record<string, unknown> = {
    select: chain,
    eq: chain,
    is: chain,
    gte: chain,
    lte: chain,
    in: chain,
    order: chain,
    limit: chain,
    single: () => Promise.resolve(result),
    maybeSingle: () => Promise.resolve(result),
    then: (resolve: (v: unknown) => unknown) => resolve(result),
  };
  return builder;
}

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (_opts: unknown, handler: (ctx: { user: { id: string }; req: unknown }) => unknown) =>
    (req: unknown) =>
      handler({ user: state.user, req }),
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () =>
            Promise.resolve({ data: state.order, error: state.order ? null : new Error('not found') }),
        }),
      }),
    }),
  }),
  getAdminSupabase: () => ({
    from: (table: string) => {
      if (table === 'orders') {
        return {
          // UPDATE condizionato (doppia cassa): risolve a state.claimed
          update: () => qb({ data: state.claimed, error: null }),
          // SELECT della riconciliazione: risolve alle righe consegnate/incassate
          select: () => qb({ data: state.reconRows, error: null }),
        };
      }
      if (table === 'cod_reconciliations') return { upsert: () => Promise.resolve({ error: null }) };
      if (table === 'profiles') return { select: () => qb({ data: [], error: null }) };
      if (table === 'notifications') return { insert: () => Promise.resolve({ error: null }) };
      return { select: () => qb({ data: [], error: null }) };
    },
  }),
}));

function reqWith(body: Record<string, unknown>) {
  return { json: async () => body } as unknown as Request;
}

async function callPost(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/rider/cash-confirm/route');
  return (POST as unknown as (req: Request) => Promise<Response>)(reqWith(body));
}

beforeEach(() => {
  state.user = { id: 'rider-1' };
  // Ordine COD da €10 (sotto la soglia €50, niente prova obbligatoria).
  state.order = {
    id: ORDER_ID,
    rider_id: 'rider-1',
    total_price: 10,
    payment_method: 'cod',
    delivery_status: 'DELIVERED',
    cash_confirmed_at: null,
  };
  state.claimed = [{ id: ORDER_ID }];
  state.reconRows = [{ total_price: 10, cash_collected_cents: 1000 }];
});

describe('POST /api/rider/cash-confirm', () => {
  it('prima conferma valida → 200', async () => {
    const res = await callPost({ orderId: ORDER_ID, cashCollectedCents: 1000 });
    expect(res.status).toBe(200);
  });

  it('doppia conferma concorrente: la seconda riceve 409 (guard atomico)', async () => {
    // L'UPDATE condizionato non matcha: un'altra richiesta ha già vinto la corsa.
    state.claimed = [];
    const res = await callPost({ orderId: ORDER_ID, cashCollectedCents: 1000 });
    expect(res.status).toBe(409);
  });

  it('incasso già confermato (fast-path) → 409', async () => {
    state.order = { ...(state.order as object), cash_confirmed_at: '2026-01-01T00:00:00Z' };
    const res = await callPost({ orderId: ORDER_ID, cashCollectedCents: 1000 });
    expect(res.status).toBe(409);
  });

  it('ordine di un altro rider → 403', async () => {
    state.user = { id: 'rider-2' };
    const res = await callPost({ orderId: ORDER_ID, cashCollectedCents: 1000 });
    expect(res.status).toBe(403);
  });

  it('ordine non COD → 409', async () => {
    state.order = { ...(state.order as object), payment_method: 'card' };
    const res = await callPost({ orderId: ORDER_ID, cashCollectedCents: 1000 });
    expect(res.status).toBe(409);
  });
});
