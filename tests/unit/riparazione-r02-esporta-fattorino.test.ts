import { describe, it, expect, vi } from 'vitest';

/**
 * R02-025 (12/11/2026) — Lo scarico dei dati del fattorino contiene le recensioni che ha ricevuto
 * (rider_reviews.rider_id) e le sue giornate di cassa (cod_reconciliations.rider_id).
 */

const RIDER = 'r-1';
const nelDb: Record<string, Array<Record<string, unknown>>> = {
  rider_reviews: [
    { id: 'rv-ricevuta', rider_id: RIDER, user_id: 'cliente-9', rating: 5 },
    { id: 'rv-scritta', rider_id: 'altro', user_id: RIDER, rating: 4 },
  ],
  cod_reconciliations: [{ id: 'cassa-1', rider_id: RIDER, for_date: '2026-11-10' }],
};

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit: (_o: unknown, handler: (ctx: { user: { id: string; email: string } }) => unknown) =>
    () => handler({ user: { id: RIDER, email: 'rider@example.com' } }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      const filtri: Array<[string, unknown]> = [];
      const q: Record<string, unknown> = {};
      let colonne = '*';
      for (const m of ['or', 'order', 'limit', 'range']) q[m] = () => q;
      q.select = (c: string) => { colonne = c; return q; };
      q.eq = (col: string, val: unknown) => { filtri.push([col, val]); return q; };
      q.single = async () => ({ data: { id: RIDER }, error: null });
      q.then = (ok: (v: unknown) => unknown) => {
        const scelte = colonne === '*' ? null : colonne.split(',').map((c) => c.trim());
        const righe = (nelDb[tabella] ?? [])
          .filter((r) => filtri.every(([c, v]) => r[c] === v))
          .map((r) => (scelte ? Object.fromEntries(scelte.map((c) => [c, r[c]])) : r));
        return Promise.resolve({ data: righe, error: null }).then(ok);
      };
      return q;
    },
  }),
}));

import { GET } from '@/app/api/account/export/route';

describe('R02-025 · lo scarico dei dati del fattorino', () => {
  it('contiene la recensione ricevuta e la giornata di cassa', async () => {
    const corpo = await (await (GET as unknown as () => Promise<Response>)()).json();
    const tutto = JSON.stringify(corpo);
    expect(tutto, 'la recensione che il fattorino ha ricevuto').toContain('rv-ricevuta');
    expect(tutto, 'la sua giornata di cassa').toContain('cassa-1');
    // Quella che ha scritto lui resta dov'era.
    expect(corpo.reviews.riders.map((r: { id: string }) => r.id)).toEqual(['rv-scritta']);
  });

  it('della recensione ricevuta non esce chi l ha scritta', async () => {
    const corpo = await (await (GET as unknown as () => Promise<Response>)()).json();
    const ricevuta = corpo.recensioni_ricevute_come_fattorino?.[0] ?? {};
    expect(ricevuta).not.toHaveProperty('user_id');
  });
});
