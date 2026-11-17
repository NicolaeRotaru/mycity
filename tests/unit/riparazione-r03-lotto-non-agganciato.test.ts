import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * R03-003 (con R03-004) — Un lotto AI partito e pagato ma non agganciato alla
 * sua riga (l'aggancio fallisce due volte) restava «in invio» senza id e senza
 * motivo: dopo 15 minuti lo stato lo chiudeva come fallito, la pagina rimetteva
 * il pulsante e se ne pagava un secondo. Adesso la riga si porta l'id del lotto
 * nel motivo e lo stato lo aggancia e lo interroga.
 *
 * Un database finto con una riga sola: durante l'avvio le scritture che
 * agganciano (con batch_id) falliscono, come nel guasto della voce.
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

type Riga = Record<string, unknown>;
const db = vi.hoisted(() => ({ riga: null as Record<string, unknown> | null, aggancioRotto: true, scritture: [] as Record<string, unknown>[] }));

function lavori() {
  const lettura = () => {
    const q: Record<string, unknown> = {};
    q.eq = () => q;
    q.in = () => q;
    q.order = () => q;
    q.limit = () => Promise.resolve({
      data: db.riga && ['submitting', 'processing', 'ready'].includes(String(db.riga.status)) ? [{ ...db.riga }] : [],
      error: null,
    });
    q.single = () => Promise.resolve({ data: db.riga ? { ...db.riga } : null, error: null });
    return q;
  };
  return {
    select: lettura,
    insert: (v: Riga) => ({
      select: () => ({
        single: () => {
          db.riga = { id: 'job-1', batch_id: null, error: null, results: [], target_lang: null, created_at: new Date().toISOString(), ...v };
          return Promise.resolve({ data: { id: 'job-1' }, error: null });
        },
      }),
    }),
    update: (v: Riga) => {
      db.scritture.push(v);
      const fallisce = db.aggancioRotto && 'batch_id' in v;
      if (!fallisce && db.riga) Object.assign(db.riga, v);
      const esito = { error: fallisce ? { code: '57014', message: 'timeout' } : null };
      const catena: Record<string, unknown> = {};
      catena.eq = () => catena;
      catena.then = (ok: (x: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(esito).then(ok, ko);
      return catena;
    },
  };
}

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (table: string) => {
      if (table === 'products') {
        return { select: () => ({ eq: () => ({ in: () => ({ order: () => ({ limit: () => Promise.resolve({ data: PRODUCTS, error: null }) }) }) }) }) };
      }
      if (table === 'categories') return { select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) };
      return lavori();
    },
  }),
}));

const submitBatchMock = vi.fn();
const pollMock = vi.fn(async (id: string) => ({ id, processingStatus: 'in_progress', counts: {}, resultsUrl: null }));
vi.mock('@/lib/ai/batch', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/batch')>();
  return {
    ...actual,
    submitBatch: (...a: unknown[]) => submitBatchMock(...(a as [])),
    pollBatch: (id: string) => pollMock(id),
  };
});
vi.mock('@/lib/ai/run', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/run')>();
  return { ...actual, registraSpesaAi: async () => undefined, controllaTettoSpesaAi: async () => () => undefined };
});

import { POST } from '@/app/api/ai/catalog-batch/start/route';
import { GET } from '@/app/api/ai/catalog-batch/status/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

const avvia = () =>
  POST(new Request('http://localhost/api/ai/catalog-batch/start', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ operation: 'improve' }),
  }) as never);
const chiediStato = () => GET(new Request('http://localhost/api/ai/catalog-batch/status?jobId=job-1') as never);

describe('un lotto partito ma non agganciato non si chiude come fallito e non se ne paga un secondo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.riga = null;
    db.aggancioRotto = true;
    db.scritture.length = 0;
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-17T10:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('un\'ora dopo lo stato aggancia il lotto pagato e lo interroga, invece di chiuderlo come fallito', async () => {
    submitBatchMock.mockResolvedValueOnce({ id: 'msgbatch_9', processingStatus: 'in_progress', counts: {}, resultsUrl: null });
    const avvio = (await (await avvia()).json()) as { status: string };
    expect(avvio.status).toBe('submitting');

    // Il database torna a rispondere; il negoziante riapre la pagina un'ora dopo.
    db.aggancioRotto = false;
    vi.setSystemTime(new Date('2026-11-17T11:00:00Z'));
    const corpo = (await (await chiediStato()).json()) as { status: string; error: string | null };

    expect(corpo.status).not.toBe('failed');
    expect(corpo.status).toBe('processing');
    expect(pollMock).toHaveBeenCalledWith('msgbatch_9');
    expect(db.riga).toMatchObject({ status: 'processing', batch_id: 'msgbatch_9' });
    expect(db.scritture.some((s) => s.status === 'failed')).toBe(false);

    // E un secondo avvio non parte: il lavoro pagato e' ancora aperto.
    const secondo = await avvia();
    expect(secondo.status).toBe(409);
    expect(submitBatchMock).toHaveBeenCalledTimes(1);
  });
});
