import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * S01 — 33: il comando interno per pagare un negozio passa dagli stessi
 * cancelli del giro dei bonifici (resi aperti, reclami aperti, contestazione in
 * banca, ora di attesa).
 */
const st = vi.hoisted(() => ({
  ordine: {} as Record<string, unknown>,
  resi: [] as unknown[],
  reclami: [] as unknown[],
  pagati: [] as string[],
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/api/middleware', () => ({ withInternalAuth: (h: (r: Request) => unknown) => (r: Request) => h(r) }));
vi.mock('@/lib/stripe/client', () => ({ isStripeConfigured: () => true }));
vi.mock('@/lib/stripe/payout', () => ({
  releaseOrderPayout: async (id: string) => (st.pagati.push(id), { ok: true, transferId: 'tr_1' }),
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (t: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in']) q[m] = () => q;
      q.maybeSingle = async () => ({ data: st.ordine, error: null });
      q.limit = async () => ({ data: t === 'returns' ? st.resi : st.reclami, error: null });
      return q;
    },
  }),
}));
import { POST } from '@/app/api/stripe/payout/route';

const ID = '11111111-1111-4111-8111-111111111111';
const paga = async () => {
  const r = await (POST as unknown as (r: Request) => Promise<Response>)(
    new Request('http://x/api/stripe/payout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orderId: ID }) }),
  );
  return r.status;
};
const ieri = new Date(Date.now() - 86_400_000).toISOString();

beforeEach(() => {
  st.ordine = { dispute_status: null, internal_dispute_status: null, delivered_at: ieri };
  st.resi = [];
  st.reclami = [];
  st.pagati = [];
});

describe('33 — il bonifico a mano passa dai cancelli del giro', () => {
  it('senza niente di aperto si paga', async () => {
    expect(await paga()).toBe(200);
    expect(st.pagati).toEqual([ID]);
  });
  it('reso aperto: 409, nessun bonifico', async () => {
    st.resi = [{ id: 'r1' }];
    expect(await paga()).toBe(409);
    expect(st.pagati).toEqual([]);
  });
  it('reclamo aperto: 409', async () => {
    st.reclami = [{ id: 'd1' }];
    expect(await paga()).toBe(409);
  });
  it('contestazione in banca aperta: 409', async () => {
    st.ordine = { ...st.ordine, dispute_status: 'OPEN' };
    expect(await paga()).toBe(409);
  });
  it('consegnato da pochi minuti: 409', async () => {
    st.ordine = { ...st.ordine, delivered_at: new Date().toISOString() };
    expect(await paga()).toBe(409);
  });
});
