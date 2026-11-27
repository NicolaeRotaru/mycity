import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R24 — Quando l'annullo dal sito fallisce la rotta risponde 500 (stesso testo)
 * e scrive una riga nel registro.
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
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({
          data: { id: 'ord-1', user_id: 'cliente1', seller_id: 's1', delivery_status: 'NEW' },
          error: null,
        }),
      };
      return q;
    },
  }),
}));
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (_o: unknown, h: (ctx: unknown) => unknown) =>
    async (req: unknown, ctx: { params: Record<string, string> }) =>
      h({ req, user: { id: 'cliente1' }, params: ctx.params }),
}));

import { POST } from '@/app/api/orders/[id]/cancel/route';

const chiama = () =>
  (POST as unknown as (r: unknown, c: unknown) => Promise<Response>)({}, { params: { id: 'ord-1' } });

beforeEach(() => {
  logger.error.mockClear();
});

describe('R24 — annullo del cliente fallito lascia una riga nel registro', () => {
  it('risponde 500 con lo stesso testo e scrive logger.error con id e motivo', async () => {
    annullaERimborsa.mockResolvedValueOnce({ ok: false, motivo: 'ANNULLAMENTO_FALLITO', dettaglio: 'boom' });
    const res = await chiama();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).toContain('Annullamento fallito');
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0][1]).toMatchObject({ orderId: 'ord-1', motivo: 'ANNULLAMENTO_FALLITO' });
  });

  it('un esito atteso (già annullato) non scrive errori', async () => {
    annullaERimborsa.mockResolvedValueOnce({ ok: false, motivo: 'GIA_ANNULLATO' });
    const res = await chiama();
    expect(res.status).toBe(409);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
