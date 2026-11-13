import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * R04-025 (revisione) — Con un lavoro aperto la rotta di avvio dice
 * «applicalo o scartalo», ma scartarlo non si poteva. Adesso un lavoro PRONTO
 * del venditore si scarta, e la pagina ha il pulsante.
 */
const FAKE_USER = { id: 'seller-1', email: 's@x.com' };
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth:
    (h: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) => (req: Request) =>
      h({ user: FAKE_USER, req }),
}));
const filtri: Array<[string, unknown]> = [];
const aggiornati: Record<string, unknown>[] = [];
let righeToccate: unknown[] = [{ id: 'job-1' }];
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: () => ({
      update: (v: Record<string, unknown>) => {
        aggiornati.push(v);
        const q = {
          eq: (c: string, val: unknown) => { filtri.push([c, val]); return q; },
          select: () => Promise.resolve({ data: righeToccate, error: null }),
        };
        return q;
      },
    }),
  }),
}));

import { POST } from '@/app/api/ai/catalog-batch/cancel/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

const scarta = () =>
  POST(new Request('http://localhost/api/ai/catalog-batch/cancel', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobId: 'job-1' }),
  }) as never);

describe('scartare un lavoro pronto', () => {
  beforeEach(() => { filtri.length = 0; aggiornati.length = 0; __resetRateLimitBuckets(); });

  it('lavoro pronto del venditore: diventa annullato', async () => {
    righeToccate = [{ id: 'job-1' }];
    const res = await scarta();
    expect(res.status).toBe(200);
    expect(aggiornati[0]).toMatchObject({ status: 'canceled' });
    expect(filtri).toContainEqual(['seller_id', 'seller-1']);
    expect(filtri).toContainEqual(['status', 'ready']);
  });

  it('se non c\'e\' un lavoro pronto del venditore: 409, niente annullato', async () => {
    righeToccate = [];
    expect((await scarta()).status).toBe(409);
  });

  it('la pagina ha il pulsante «Scarta» accanto ad «Applica»', () => {
    const src = readFileSync('app/seller/products/ai-batch/page.tsx', 'utf8');
    expect(src).toContain("authedFetch('/api/ai/catalog-batch/cancel'");
    expect(src).toMatch(/>\s*Scarta\s*</);
  });
});
