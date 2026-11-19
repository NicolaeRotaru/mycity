import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { APIConnectionTimeoutError } from '@anthropic-ai/sdk';

/**
 * R03-002 (giro di correzione) — La riga del lotto nasce col motivo «forse
 * partito» (INVIO_SENZA_RISPOSTA), che lo stato tiene aperto 24 ore. Quando il
 * lavoro NON e' partito (rifiuto netto del fornitore, tetto di spesa del
 * giorno) la rotta la chiude: «fallita» o «annullata». Ma quelle due scritture
 * non guardavano l'errore: se il database le rifiutava una volta, la riga
 * restava «in invio» con il motivo per 24 ore, e il negozio leggeva «Riprova»,
 * poi 409 «Applicalo o scartalo» (che non poteva fare), poi la rotella.
 *
 * Adesso ciascuna si ritenta una volta, e se e' ancora rifiutata il registro
 * lo dice con l'id della riga e il codice. Il 409 su una riga «in invio» dice
 * che l'invio e' da verificare e di ricaricare fra qualche minuto.
 *
 * Un database finto con una riga sola: rifiuta le scritture che la prova sceglie.
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
  /** Quante delle prossime scritture che passano il filtro il database rifiuta. */
  daRifiutare: 0,
  filtro: ((_v: Record<string, unknown>) => false) as (v: Record<string, unknown>) => boolean,
  tettoFerma: false,
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
    return q;
  };
  return {
    select: lettura,
    insert: (v: Riga) => ({
      select: () => ({
        single: () => {
          db.riga = { id: 'job-1', batch_id: null, error: null, results: [], target_lang: null, ...v };
          return Promise.resolve({ data: { id: 'job-1' }, error: null });
        },
      }),
    }),
    update: (v: Riga) => {
      const rifiutata = db.filtro(v) && db.daRifiutare > 0;
      if (rifiutata) db.daRifiutare -= 1;
      else if (db.riga) Object.assign(db.riga, v);
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
      if (db.tettoFerma) throw actual.AiCallError.perTettoSpesa(feature);
      return () => undefined;
    },
  };
});

import { POST } from '@/app/api/ai/catalog-batch/start/route';
import { logger } from '@/lib/logger';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

const avvia = () =>
  POST(new Request('http://localhost/api/ai/catalog-batch/start', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ operation: 'improve' }),
  }) as never);

const LOTTO = { id: 'msgbatch_2', processingStatus: 'in_progress', counts: {}, resultsUrl: null };

describe('R03-002 — la chiusura del lavoro mai partito si ritenta: un rifiuto del database non blocca il negozio per 24 ore', () => {
  let errori: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.clearAllMocks();
    db.riga = null;
    db.daRifiutare = 0;
    db.filtro = () => false;
    db.tettoFerma = false;
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    errori = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    errori.mockRestore();
    vi.unstubAllEnvs();
  });

  it('rifiuto netto, la prima scrittura «fallita» rifiutata e la seconda accettata: la riga e\' fallita e un nuovo avvio parte', async () => {
    submitBatchMock.mockRejectedValueOnce(new Error('400 bad request'));
    db.filtro = (v) => v.status === 'failed';
    db.daRifiutare = 1;
    const primo = await avvia();
    expect(primo.status).toBe(502);
    expect(db.riga).toMatchObject({ status: 'failed', error: null });

    submitBatchMock.mockResolvedValueOnce(LOTTO);
    const secondo = await avvia();
    expect(secondo.status).toBe(200);
    expect(submitBatchMock).toHaveBeenCalledTimes(2);
  });

  it('tetto di spesa, la prima scrittura «annullata» rifiutata e la seconda accettata: la riga e\' annullata e un nuovo avvio parte', async () => {
    db.tettoFerma = true;
    db.filtro = (v) => v.status === 'canceled';
    db.daRifiutare = 1;
    const primo = await avvia();
    expect(primo.status).toBe(503);
    expect(db.riga?.status).toBe('canceled');
    expect(submitBatchMock).not.toHaveBeenCalled();

    db.tettoFerma = false;
    submitBatchMock.mockResolvedValueOnce(LOTTO);
    const secondo = await avvia();
    expect(secondo.status).toBe(200);
    expect(submitBatchMock).toHaveBeenCalledTimes(1);
  });

  it('se anche il secondo tentativo e\' rifiutato, il registro lo dice con l\'id della riga e il codice', async () => {
    submitBatchMock.mockRejectedValueOnce(new Error('400 bad request'));
    db.filtro = (v) => v.status === 'failed';
    db.daRifiutare = 2;
    await avvia();
    expect(errori).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ jobId: 'job-1', status: '57014' }));

    errori.mockClear();
    db.riga = null;
    db.tettoFerma = true;
    db.filtro = (v) => v.status === 'canceled';
    db.daRifiutare = 2;
    await avvia();
    expect(errori).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ jobId: 'job-1', status: '57014' }));
  });

  it('il 409 su un lavoro «in invio» dice che l\'invio e\' da verificare e di ricaricare, non «applicalo o scartalo»', async () => {
    submitBatchMock.mockRejectedValueOnce(new APIConnectionTimeoutError());
    expect((await avvia()).status).toBe(503);
    expect(db.riga?.status).toBe('submitting');

    const secondo = await avvia();
    expect(secondo.status).toBe(409);
    const testo = JSON.stringify(await secondo.json());
    expect(testo).toMatch(/verificare/i);
    expect(testo).toMatch(/ricarica/i);
    expect(testo).not.toMatch(/Applicalo o scartalo/);
    expect(submitBatchMock).toHaveBeenCalledTimes(1);
  });

  it('il 409 su un lavoro in corso o pronto dice ancora «applicalo o scartalo»', async () => {
    submitBatchMock.mockResolvedValueOnce(LOTTO);
    expect((await avvia()).status).toBe(200);
    expect(db.riga?.status).toBe('processing');

    const secondo = await avvia();
    expect(secondo.status).toBe(409);
    expect(JSON.stringify(await secondo.json())).toMatch(/Applicalo o scartalo/);
  });
});
