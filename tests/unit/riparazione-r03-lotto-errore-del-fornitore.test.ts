import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InternalServerError } from '@anthropic-ai/sdk';

/**
 * R03-009 — Se l'invio di un lotto AI restava senza risposta, il sito lo
 * rimandava e Anthropic ne eseguiva due. Il ritentativo automatico non c'e' piu'
 * (R04-014) e un invio senza connessione resta «da verificare»; ma un 504 (o un
 * 500/502) del fornitore, che puo' arrivare a lotto gia' creato, chiudeva la
 * riga come fallita e invitava a riprovare: secondo lotto, secondo pagamento.
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
  return { ...actual, registraSpesaAi: async () => undefined, controllaTettoSpesaAi: async () => async () => undefined };
});

import { POST } from '@/app/api/ai/catalog-batch/start/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

const richiesta = () =>
  new Request('http://localhost/api/ai/catalog-batch/start', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ operation: 'improve' }),
  }) as never;

const erroreDelFornitore = (status: number) =>
  new InternalServerError(status, { type: 'error', error: { type: 'api_error', message: 'x' } }, `${status}`, new Headers());

describe('un errore del fornitore che puo\' arrivare a lotto creato non apre la porta a un secondo lotto', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    aggiornamenti.length = 0;
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  });

  it.each([504, 502, 500])('%i: la riga non diventa «failed» e il negoziante sa di non riavviare', async (status) => {
    submitBatchMock.mockRejectedValueOnce(erroreDelFornitore(status));
    const res = await POST(richiesta());
    expect(res.status).toBe(503);
    expect(aggiornamenti.some((a) => a.status === 'failed')).toBe(false);
    expect(aggiornamenti.some((a) => typeof a.error === 'string' && /potrebbe essere partito/.test(a.error))).toBe(true);
    expect(JSON.stringify(await res.json())).toMatch(/Non riavviarlo/);
    expect(submitBatchMock).toHaveBeenCalledTimes(1);
  });

  it('529 (sovraccarico, richiesta non presa): resta «failed» e si puo\' riprovare', async () => {
    submitBatchMock.mockRejectedValueOnce(erroreDelFornitore(529));
    const res = await POST(richiesta());
    expect(res.status).toBe(502);
    expect(aggiornamenti.some((a) => a.status === 'failed')).toBe(true);
  });
});
