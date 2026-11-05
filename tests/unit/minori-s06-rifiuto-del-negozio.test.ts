import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * S06 · 2509 — Il rifiuto del negozio dice al cliente «il credito è tornato»
 * solo per il credito tornato davvero.
 */

const stato = vi.hoisted(() => ({
  notifiche: [] as Record<string, unknown>[],
  esito: { ok: true, refundId: null } as Record<string, unknown>,
}));

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (_o: unknown, h: (ctx: Record<string, unknown>) => unknown) =>
    async (req: Request, ctx?: { params: Promise<Record<string, string>> }) =>
      h({ user: { id: 'seller-1' }, req, params: (await ctx?.params) ?? {} }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/ordini/annulla', () => ({
  COLONNE_ANNULLO: 'id',
  annullaERimborsa: async () => stato.esito,
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (t: string) =>
      t === 'orders'
        ? {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 'ordine-0001', user_id: 'buyer-1', seller_id: 'seller-1',
                    delivery_status: 'NEW', wallet_applied_cents: 500, coupon_code: null, rider_id: null,
                  },
                  error: null,
                }),
              }),
            }),
          }
        : { insert: async (r: Record<string, unknown>[]) => { stato.notifiche.push(...r); return { error: null }; } },
  }),
}));

const { POST } = await import('@/app/api/seller/orders/[id]/reject/route');
const rifiuta = () =>
  (POST as unknown as (r: Request, c: unknown) => Promise<Response>)(
    new Request('http://x/api/seller/orders/ordine-0001/reject', { method: 'POST', body: '{}' }),
    { params: Promise.resolve({ id: 'ordine-0001' }) },
  );

beforeEach(() => { stato.notifiche = []; });

describe('2509 — credito tornato davvero', () => {
  it('se lo storno del credito è caduto, non scrive «è tornato sul tuo saldo»', async () => {
    stato.esito = { ok: true, refundId: null, creditoNonTornatoCents: 500 };
    expect((await rifiuta()).status).toBe(200);
    const body = String(stato.notifiche[0]?.body);
    expect(body).not.toContain('è tornato sul tuo saldo');
    expect(body).toContain('non è ancora tornato');
  });
  it('se il credito è tornato, lo dice con l\'importo', async () => {
    stato.esito = { ok: true, refundId: null };
    await rifiuta();
    expect(String(stato.notifiche[0]?.body)).toContain('(€5.00) è tornato sul tuo saldo');
  });
});
