import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * R03-002 — Quando il tetto di spesa AI del giorno fermava un lavoro sul
 * catalogo, il freno finiva nel ramo dei guasti: il negoziante leggeva «Non sono
 * riuscito ad avviare il lavoro. Riprova.» e la riga diventava «fallita». Il
 * lavoro non e' partito e non e' costato niente: si dice che il budget del
 * giorno e' finito, e la riga non risulta fallita.
 */

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
vi.mock('@/lib/ai/run', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/run')>();
  return {
    ...actual,
    registraSpesaAi: async () => undefined,
    controllaTettoSpesaAi: async (feature: string) => {
      throw actual.AiCallError.perTettoSpesa(feature);
    },
  };
});

import { POST } from '@/app/api/ai/catalog-batch/start/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

const richiesta = () =>
  new Request('http://localhost/api/ai/catalog-batch/start', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ operation: 'improve' }),
  }) as never;

describe('il tetto di spesa che ferma un lavoro sul catalogo non e\' un guasto', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    aggiornamenti.length = 0;
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  });

  it('il negoziante legge che il budget del giorno e\' finito, e la riga non risulta fallita', async () => {
    const res = await POST(richiesta());
    const testo = JSON.stringify(await res.json());
    expect(res.status).toBe(503);
    expect(testo).toMatch(/Budget AI giornaliero esaurito/);
    expect(testo).not.toMatch(/Non sono riuscito ad avviare il lavoro/);
    expect(aggiornamenti.some((a) => a.status === 'failed')).toBe(false);
    expect(submitBatchMock).not.toHaveBeenCalled();
  });
});
