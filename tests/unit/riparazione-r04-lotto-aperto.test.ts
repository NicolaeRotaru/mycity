import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * R04-025 — La rotta di avvio del lavoro AI sul catalogo non rifiutava un
 * secondo lavoro: con il primo ancora aperto ne partiva un altro, pagato di
 * nuovo. Adesso risponde 409 con l'id del lavoro aperto, senza mandare niente
 * al modello e senza impegnare spesa.
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
let lavoriAperti: { id: string; status: string }[] = [];
const filtriStato: unknown[] = [];
const inseriti: unknown[] = [];
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (table: string) => {
      if (table === 'products') {
        return { select: () => ({ eq: () => ({ in: () => ({ order: () => ({ limit: () => Promise.resolve({ data: PRODUCTS, error: null }) }) }) }) }) };
      }
      if (table === 'categories') {
        return { select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) };
      }
      return {
        select: () => ({
          eq: () => ({
            in: (_c: string, stati: unknown) => {
              filtriStato.push(stati);
              return { order: () => ({ limit: () => Promise.resolve({ data: lavoriAperti, error: null }) }) };
            },
          }),
        }),
        insert: (v: unknown) => {
          inseriti.push(v);
          return { select: () => ({ single: () => Promise.resolve({ data: { id: 'job-2' }, error: null }) }) };
        },
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    },
  }),
}));

const submitBatchMock = vi.fn(async () => ({ id: 'batch_2', processingStatus: 'in_progress', counts: {}, resultsUrl: null }));
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

describe('un secondo lavoro sul catalogo non parte', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    filtriStato.length = 0;
    inseriti.length = 0;
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  });

  it('con un lavoro in corso: 409 con il suo id, nessun lotto, nessuna spesa, nessuna riga nuova', async () => {
    lavoriAperti = [{ id: 'job-1', status: 'processing' }];
    const res = await POST(richiesta());
    expect(res.status).toBe(409);
    const corpo = (await res.json()) as { error: { details: { jobId: string } } };
    expect(corpo.error.details.jobId).toBe('job-1');
    expect(submitBatchMock).not.toHaveBeenCalled();
    expect(registraSpesaMock).not.toHaveBeenCalled();
    expect(inseriti).toHaveLength(0);
  });

  it('aperti sono in invio, in corso e pronti da rivedere', async () => {
    lavoriAperti = [];
    const res = await POST(richiesta());
    expect(res.status).toBe(200);
    expect(filtriStato[0]).toEqual(expect.arrayContaining(['submitting', 'processing', 'ready']));
    expect(submitBatchMock).toHaveBeenCalledTimes(1);
  });
});
