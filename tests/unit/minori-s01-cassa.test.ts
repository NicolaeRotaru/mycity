import { describe, it, expect, vi } from 'vitest';
import { aggiornaQuadratura } from '@/lib/cassa/quadratura';

/**
 * S01 — 555: se la lettura degli ordini non riesce, la cassa del fattorino non
 * viene riscritta come «tutto in ordine, zero euro» sopra un ammanco vero.
 */
function client(opts: { letturaCade?: boolean; scritturaCade?: boolean; righe?: unknown[] }) {
  const scritte: unknown[] = [];
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'gte']) q[m] = () => q;
  q.lt = async () =>
    opts.letturaCade ? { data: null, error: { message: 'statement timeout' } } : { data: opts.righe ?? [], error: null };
  const admin = {
    from: (t: string) =>
      t === 'orders'
        ? q
        : {
            upsert: async (riga: unknown) => {
              scritte.push(riga);
              return { error: opts.scritturaCade ? { message: 'giu' } : null };
            },
          },
  };
  return { admin: admin as never, scritte };
}

describe('555 — la quadratura non scrive un conto falso', () => {
  it('lettura caduta: non scrive niente e lancia', async () => {
    const { admin, scritte } = client({ letturaCade: true });
    await expect(aggiornaQuadratura(admin, 'marco', '2026-10-10')).rejects.toThrow();
    expect(scritte).toHaveLength(0);
  });
  it('scrittura caduta: lancia', async () => {
    const { admin } = client({ scritturaCade: true });
    await expect(aggiornaQuadratura(admin, 'marco', '2026-10-10')).rejects.toThrow();
  });
  it('senza guasti scrive la riga della giornata', async () => {
    const { admin, scritte } = client({});
    await aggiornaQuadratura(admin, 'marco', '2026-10-10');
    expect(scritte).toHaveLength(1);
  });
});

describe('555 — riquadra-casse risponde errore se una giornata non si rifà', () => {
  it('falliti > 0 → 500', async () => {
    vi.resetModules();
    vi.doMock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
    vi.doMock('@/lib/cassa/quadratura', () => ({ aggiornaQuadratura: async () => { throw new Error('giu'); } }));
    const righe = [{ rider_id: 'marco', delivered_at: new Date().toISOString() }];
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'gte']) q[m] = () => q;
    q.not = async () => ({ data: righe, error: null });
    vi.doMock('@/lib/supabase/server', () => ({ getAdminSupabase: () => ({ from: () => q }) }));
    vi.stubEnv('CRON_SECRET', 's');
    vi.stubEnv('LAVORI_A_ORARIO', 'accesi');
    const { POST } = await import('@/app/api/cron/riquadra-casse/route');
    const r = await (POST as unknown as (r: Request) => Promise<Response>)(
      new Request('http://x/api/cron/riquadra-casse', { headers: { authorization: 'Bearer s' } }),
    );
    expect(r.status).toBe(500);
    expect(await r.json()).toMatchObject({ ok: false, falliti: 1 });
    vi.unstubAllEnvs();
  });
});
