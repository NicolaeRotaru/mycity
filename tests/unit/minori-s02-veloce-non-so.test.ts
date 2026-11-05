import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * Sessione S02 (5/11/2026), scheda 2272 — se il database cade, /api/consegna/veloce non risponde
 * 200 «non possibile» (che la vetrina legge come «no» e trasforma in «consegna domani»), ma 503:
 * i lettori che guardano solo le risposte riuscite (useVeloceDelNegozio, il carrello) restano su «non so».
 */
const stato = vi.hoisted(() => ({ rotto: false }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/rate-limit', () => ({ getClientIp: () => '1.2.3.4', rateLimitAsync: async () => ({ allowed: true }) }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: () => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.in = () => q;
      q.then = (ok: (r: unknown) => unknown) =>
        Promise.resolve(stato.rotto ? { data: null, count: null, error: { message: 'giù' } } : { data: [], count: 0, error: null }).then(ok);
      return q;
    },
  }),
}));

import { GET } from '@/app/api/consegna/veloce/route';

const NEGOZIO = '11111111-1111-4111-8111-111111111111';
afterEach(() => { stato.rotto = false; });

describe('la rotta della veloce distingue «no» da «non so»', () => {
  it('con il database giù risponde 503, non 200', async () => {
    stato.rotto = true;
    const r = await GET(new Request(`https://mycity.test/api/consegna/veloce?negozi=${NEGOZIO}`));
    expect(r.status).toBe(503);
    expect(r.ok).toBe(false);
  });

  it('il lettore della vetrina, con quella risposta, resta su «non so» (null)', async () => {
    stato.rotto = true;
    const r = await GET(new Request(`https://mycity.test/api/consegna/veloce?negozi=${NEGOZIO}`));
    const letto = r.ok ? ((await r.json()) as { possibile?: boolean }).possibile === true : null;
    expect(letto).toBeNull();
  });
});

describe('revisione · un negozio non più approvato è un «no» col motivo, non un guasto', () => {
  it('risponde 200 possibile:false con il perché', async () => {
    const r = await GET(new Request(`https://mycity.test/api/consegna/veloce?negozi=${NEGOZIO}`));
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { possibile?: boolean; perche?: string };
    expect(corpo.possibile).toBe(false);
    expect(corpo.perche ?? '').toContain('non accetta ordini');
  });
});
