import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R24 — Quando l'annullo dell'amministrazione fallisce la rotta risponde 500
 * e scrive una riga nel registro (prima rispondeva e basta).
 */
const logger = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }));
const annullaERimborsa = vi.hoisted(() => vi.fn());

vi.mock('@/lib/logger', () => ({ logger }));
vi.mock('@/lib/ordini/annulla', () => ({
  annullaERimborsa,
  COLONNE_ANNULLO: 'id',
  avvisaIlNegozioDellAnnullo: vi.fn(async () => true),
}));
vi.mock('@/lib/ordini/campanella', () => ({ scriviCampanella: vi.fn(async () => undefined) }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => undefined) }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        single: async () => ({
          data: { id: 'ord-1', user_id: 'u1', seller_id: 's1', delivery_status: 'NEW', payment_method: 'card', total_price: 10 },
          error: null,
        }),
      };
      return q;
    },
  }),
}));
vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth:
    (h: (ctx: unknown) => unknown) =>
    async (req: unknown, ctx: { params: Record<string, string> }) =>
      h({ req, user: { id: 'admin1' }, params: ctx.params }),
}));

import { POST } from '@/app/api/admin/orders/[id]/cancel/route';

const chiama = () =>
  (POST as unknown as (r: unknown, c: unknown) => Promise<Response>)(
    new Request('http://x/api', { method: 'POST', body: '{}' }),
    { params: { id: 'ord-1' } },
  );

beforeEach(() => {
  logger.error.mockClear();
});

describe('R24 — annullo admin fallito lascia una riga nel registro', () => {
  it('risponde 500 con lo stesso testo e scrive logger.error con id e motivo', async () => {
    annullaERimborsa.mockResolvedValueOnce({ ok: false, motivo: 'ANNULLAMENTO_FALLITO', dettaglio: 'boom' });
    const res = await chiama();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).toContain('Annullamento fallito');
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [, ctx] = logger.error.mock.calls[0];
    expect(ctx).toMatchObject({ orderId: 'ord-1', motivo: 'ANNULLAMENTO_FALLITO' });
  });

  it('un esito atteso (già annullato) non scrive errori', async () => {
    annullaERimborsa.mockResolvedValueOnce({ ok: false, motivo: 'GIA_ANNULLATO' });
    const res = await chiama();
    expect(res.status).toBe(409);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
