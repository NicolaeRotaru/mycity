import { describe, it, expect, beforeEach, vi } from 'vitest';
import { APIConnectionTimeoutError } from '@anthropic-ai/sdk';

/** R04-014 — un invio del lotto senza risposta non si dichiara fallito. */

const FAKE_USER = { id: 'seller-1', email: 's@x.com' };
vi.mock('@/lib/funzioni-al-lancio', async (originale) => ({
  ...((await originale()) as Record<string, unknown>),
  AI_NEGOZI_ACCESA: true,
}));
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth:
    (h: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) => (req: Request) =>
      h({ user: FAKE_USER, req }),
}));
const PRODUCTS = [{
  id: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Pane', description: 'x', price: 3, compare_at_price: null,
  unit: 'pezzo', condition: null, stock: 1, status: 'available', category_id: 'al',
  images: [], attributes: {}, tags: [], has_variants: false,
}];
const aggiornamenti: Record<string, unknown>[] = [];
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (table: string) => {
      if (table === 'products') {
        return { select: () => ({ eq: () => ({ in: () => ({ order: () => ({ limit: () => Promise.resolve({ data: PRODUCTS, error: null }) }) }) }) }) };
      }
      if (table === 'categories') return { select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) };
      return {
        select: () => ({ eq: () => ({ in: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }) }),
        insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'job-1' }, error: null }) }) }),
        update: (v: Record<string, unknown>) => {
          aggiornamenti.push(v);
          return { eq: () => Promise.resolve({ error: null }) };
        },
      };
    },
  }),
}));
const submitBatchMock = vi.fn();
vi.mock('@/lib/ai/batch', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/batch')>();
  return { ...actual, submitBatch: (...a: unknown[]) => submitBatchMock(...(a as [])) };
});
const registraSpesaMock = vi.fn(async () => undefined);
vi.mock('@/lib/ai/run', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/run')>();
  return { ...actual, registraSpesaAi: () => registraSpesaMock(), controllaTettoSpesaAi: async () => () => undefined };
});

import { POST } from '@/app/api/ai/catalog-batch/start/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

const richiesta = () =>
  new Request('http://localhost/api/ai/catalog-batch/start', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ operation: 'improve' }),
  }) as never;

describe('invio del lotto senza risposta', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    aggiornamenti.length = 0;
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  });

  it('la riga non diventa «failed» e il negoziante sa di non riavviare', async () => {
    submitBatchMock.mockRejectedValueOnce(new APIConnectionTimeoutError());
    const res = await POST(richiesta());
    expect(res.status).toBe(503);
    expect(aggiornamenti.some((a) => a.status === 'failed')).toBe(false);
    expect(JSON.stringify(await res.json())).toMatch(/potrebbe essere partito/);
    expect(submitBatchMock).toHaveBeenCalledTimes(1);
  });

  it('un rifiuto vero del fornitore resta «failed»', async () => {
    submitBatchMock.mockRejectedValueOnce(new Error('400 bad request'));
    const res = await POST(richiesta());
    expect(res.status).toBe(502);
    expect(aggiornamenti.some((a) => a.status === 'failed')).toBe(true);
  });
});
