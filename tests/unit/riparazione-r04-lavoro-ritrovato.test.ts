import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * R04-013 — Se il negoziante usciva dalla pagina mentre «migliora tutto il
 * catalogo» lavorava, da un altro dispositivo il lavoro pagato non si
 * ritrovava piu'. Adesso lo stato, chiamato senza jobId, restituisce l'ultimo
 * lavoro ancora aperto del venditore, e la pagina lo chiede all'apertura.
 */

const FAKE_USER = { id: 'seller-1', email: 's@x.com' };
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth:
    (h: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) => (req: Request) =>
      h({ user: FAKE_USER, req }),
}));

let aperti: Record<string, unknown>[] = [];
const filtri: { col: string; val: unknown }[] = [];
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: (col: string, val: unknown) => {
          filtri.push({ col, val });
          return {
            in: (c: string, stati: unknown) => {
              filtri.push({ col: c, val: stati });
              return { order: () => ({ limit: () => Promise.resolve({ data: aperti, error: null }) }) };
            },
            single: () => Promise.resolve({ data: null, error: null }),
          };
        },
      }),
    }),
  }),
}));

import { GET } from '@/app/api/ai/catalog-batch/status/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

const chiedi = () => GET(new Request('http://localhost/api/ai/catalog-batch/status') as never);

describe('il lavoro aperto si ritrova da qualunque dispositivo', () => {
  beforeEach(() => {
    filtri.length = 0;
    __resetRateLimitBuckets();
  });

  it('senza jobId: torna l\'ultimo lavoro aperto del venditore', async () => {
    aperti = [{
      id: 'job-7', seller_id: 'seller-1', operation: 'improve', status: 'ready', batch_id: 'b7',
      target_lang: null, total: 60, results: [{ product_id: 'p1', patch: { name: 'x' } }], created_at: '2026-11-12T10:00:00Z', error: null,
    }];
    const res = await chiedi();
    expect(res.status).toBe(200);
    const corpo = (await res.json()) as { id: string; status: string };
    expect(corpo).toMatchObject({ id: 'job-7', status: 'ready' });
    expect(filtri).toContainEqual({ col: 'seller_id', val: 'seller-1' });
    expect(filtri).toContainEqual({ col: 'status', val: ['submitting', 'processing', 'ready'] });
  });

  it('senza lavori aperti: null, non un errore', async () => {
    aperti = [];
    const res = await chiedi();
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it('la pagina, senza un lavoro ricordato, lo chiede al server', () => {
    const src = readFileSync('app/seller/products/ai-batch/page.tsx', 'utf8');
    expect(src).toContain("authedFetch('/api/ai/catalog-batch/status')");
    expect(src).toMatch(/else void riprendiUltimo\(\)/);
  });
});
