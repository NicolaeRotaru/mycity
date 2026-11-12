import { describe, it, expect, beforeEach, vi } from 'vitest';
import { APIConnectionTimeoutError } from '@anthropic-ai/sdk';

/** R04-005 — se il lotto parte ma la riga non si aggancia, la rotta dice lo stato vero. */

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
          return { eq: () => Promise.resolve({ error: { code: '57014' } }) };
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

describe('lotto partito ma non agganciato', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    aggiornamenti.length = 0;
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  });

  it('si ritenta l\'aggancio e, se non riesce, la risposta dice «in invio», non «in corso»', async () => {
    submitBatchMock.mockResolvedValueOnce({ id: 'batch_9', processingStatus: 'in_progress', counts: {}, resultsUrl: null });
    const res = await POST(richiesta());
    expect(res.status).toBe(200);
    const corpo = (await res.json()) as { status: string; jobId: string };
    expect(corpo.status).toBe('submitting');
    expect(aggiornamenti.filter((a) => a.batch_id === 'batch_9')).toHaveLength(2);
  });
});
