import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { APIConnectionTimeoutError } from '@anthropic-ai/sdk';

/**
 * R03-002 (giro 2) — Un lotto AI partito e pagato ma non agganciato alla sua riga
 * si chiudeva come fallito dopo 15 minuti, e se ne poteva pagare un secondo.
 * Dopo il primo giro la rotta di avvio scrive un motivo che lo stato riconosce
 * (l'id del lotto, o «invio senza risposta»): ma se il database rifiuta proprio
 * quella scrittura la riga restava «in invio» senza motivo, lo stato la chiudeva
 * come fallita dopo 15 minuti e il secondo avvio pagava un secondo lotto.
 *
 * Un database finto con una riga sola: rifiuta le scritture che la prova sceglie.
 * Si avvia, si torna 16 minuti dopo a chiedere lo stato, si riavvia.
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
const db = vi.hoisted(() => ({
  riga: null as Record<string, unknown> | null,
  rifiuta: ((_v: Record<string, unknown>) => false) as (v: Record<string, unknown>) => boolean,
}));

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
      const rifiutata = db.rifiuta(v);
      if (!rifiutata && db.riga) Object.assign(db.riga, v);
      const esito = { error: rifiutata ? { code: '57014', message: 'timeout' } : null };
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

/** 16 minuti dopo il negoziante riapre la pagina, poi prova a ripartire. */
async function sediciMinutiDopoERiavvia() {
  vi.setSystemTime(new Date('2026-11-19T10:16:00Z'));
  const stato = (await (await chiediStato()).json()) as { status: string; error: string | null };
  const secondo = await avvia();
  return { stato, secondo };
}

describe('R03-002 — se il database rifiuta il motivo, il lotto pagato non si chiude dopo 15 minuti e non se ne paga un secondo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.riga = null;
    db.rifiuta = () => false;
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-19T10:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('lotto partito, aggancio rifiutato e anche il motivo con l\'id rifiutato: la riga resta aperta, il secondo avvio non paga', async () => {
    submitBatchMock.mockResolvedValueOnce({ id: 'msgbatch_9', processingStatus: 'in_progress', counts: {}, resultsUrl: null });
    // Il database rifiuta l'aggancio (con batch_id) e la scrittura del motivo con l'id.
    db.rifiuta = (v) => 'batch_id' in v || (typeof v.error === 'string' && v.error.includes('msgbatch_9'));
    const avvio = (await (await avvia()).json()) as { status: string };
    expect(avvio.status).toBe('submitting');

    db.rifiuta = () => false;
    const { stato, secondo } = await sediciMinutiDopoERiavvia();
    expect(stato.status).not.toBe('failed');
    expect(db.riga?.status).toBe('submitting');
    expect(secondo.status).toBe(409);
    expect(submitBatchMock).toHaveBeenCalledTimes(1);
  });

  it('invio senza risposta e motivo «invio senza risposta» rifiutato: la riga resta aperta, il secondo avvio non paga', async () => {
    submitBatchMock.mockRejectedValueOnce(new APIConnectionTimeoutError());
    db.rifiuta = (v) => 'error' in v && !('status' in v);
    const avvio = await avvia();
    expect(avvio.status).toBe(503);

    db.rifiuta = () => false;
    const { stato, secondo } = await sediciMinutiDopoERiavvia();
    expect(stato.status).not.toBe('failed');
    expect(db.riga?.status).toBe('submitting');
    expect(secondo.status).toBe(409);
    expect(submitBatchMock).toHaveBeenCalledTimes(1);
  });

  it('lotto agganciato: la riga e\' «in corso» senza motivo', async () => {
    submitBatchMock.mockResolvedValueOnce({ id: 'msgbatch_7', processingStatus: 'in_progress', counts: {}, resultsUrl: null });
    const avvio = (await (await avvia()).json()) as { status: string };
    expect(avvio.status).toBe('processing');
    expect(db.riga).toMatchObject({ status: 'processing', batch_id: 'msgbatch_7', error: null });
  });

  it('rifiuto netto del fornitore: la riga e\' «fallita» senza il motivo «forse partito», e si puo\' ripartire', async () => {
    submitBatchMock.mockRejectedValueOnce(new Error('400 bad request'));
    const avvio = await avvia();
    expect(avvio.status).toBe(502);
    expect(db.riga).toMatchObject({ status: 'failed', error: null });
  });
});
