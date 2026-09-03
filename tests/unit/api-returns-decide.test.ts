import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * returns/[id]/decide — audit 🟠-22: il recesso (CHANGED_MIND) entro 14 giorni è
 * incondizionato e NON può essere rifiutato dal venditore. Gli altri motivi sì.
 */

const FAKE_SELLER = { id: 'seller-1' };

// Stato configurabile: la riga return restituita da getServerSupabase.
const state: { ret: Record<string, unknown> } = {
  ret: { id: 'r1', status: 'REQUESTED', seller_id: 'seller-1', buyer_id: 'b1', order_id: 'o1', reason: 'CHANGED_MIND' },
};

// 30/8/2026 (R017) — IL FINTO INVOLUCRO ADESSO FA QUELLO CHE FA QUELLO VERO.
//
// Prima gli involucri di `lib/api/middleware.ts` prendevano solo la richiesta, e
// ogni rotta dinamica si riscriveva a mano l'adattatore che risolveva i pezzi
// dell'indirizzo. Adesso li risolve l'involucro e li consegna nel contesto: il
// finto qui sotto deve fare lo stesso, altrimenti proverebbe una rotta che nel
// sito vero non esiste piu'.
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (
      _opts: unknown,
      handler: (ctx: { user: typeof FAKE_SELLER; params: Record<string, string>; req: Request }) => unknown,
    ) =>
    async (req: Request, ctx?: { params: Promise<Record<string, string>> }) =>
      handler({ user: FAKE_SELLER, req, params: (await ctx?.params) ?? {} }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/stripe/client', () => ({ isStripeConfigured: () => true }));
vi.mock('@/lib/stripe/payout', () => ({ refundOrder: vi.fn(async () => ({ refundId: 'rf_1' })) }));

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data: state.ret, error: null }) }),
      }),
    }),
  }),
  getAdminSupabase: () => ({
    from: (table: string) => {
      if (table === 'returns') {
        return {
          update: () => ({
            eq: () => ({ eq: () => ({ select: async () => ({ data: [{ id: 'r1' }], error: null }) }) }),
          }),
        };
      }
      // 3/9/2026 — Chi comanda su un reso lo dice l'ORDINE, non la riga del
      // reso: la rotta legge il venditore di qui, dal server, perche' i campi
      // del reso il cliente se li poteva scrivere da solo.
      if (table === 'orders') {
        return {
          select: () => ({ eq: () => ({ single: async () => ({ data: { seller_id: 'seller-1' }, error: null }) }) }),
        };
      }
      if (table === 'profiles') {
        return {
          select: () => ({ eq: () => ({ single: async () => ({ data: { role: 'seller' }, error: null }) }) }),
        };
      }
      return { insert: async () => ({ error: null }) };
    },
  }),
}));

import { POST } from '@/app/api/returns/[id]/decide/route';

function call(body: unknown) {
  const req = new Request('http://localhost/api/returns/r1/decide', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return POST(req as never, { params: Promise.resolve({ id: 'r1' }) });
}

beforeEach(() => {
  state.ret = { id: 'r1', status: 'REQUESTED', seller_id: 'seller-1', buyer_id: 'b1', order_id: 'o1', reason: 'CHANGED_MIND' };
});

describe('returns/decide — recesso incondizionato (audit 🟠-22)', () => {
  it('[🟠-22] NON consente di rifiutare un recesso (CHANGED_MIND)', async () => {
    state.ret.reason = 'CHANGED_MIND';
    const res = await call({ decision: 'REJECTED' });
    expect(res.status).toBe(400);
  });

  it('consente di rifiutare un reso per altro motivo (es. DAMAGED)', async () => {
    state.ret.reason = 'DAMAGED';
    const res = await call({ decision: 'REJECTED' });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('REJECTED');
  });

  it('consente di approvare un recesso (CHANGED_MIND)', async () => {
    state.ret.reason = 'CHANGED_MIND';
    const res = await call({ decision: 'APPROVED' });
    expect(res.status).toBe(200);
  });
});
