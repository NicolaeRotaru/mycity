import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * R02-004 · R02-013 — Due avvii insieme del lavoro AI sul catalogo (doppio
 * tocco, due schede) leggevano tutti e due «nessun lavoro aperto» e partivano
 * tutti e due. Il database adesso tiene un solo lavoro aperto per negozio (la
 * prova SQL tests/sql/rls/riparazione-r02-un-solo-lavoro-aperto.test.sql): qui
 * il database finto fa lo stesso, e la rotta deve dire al secondo avvio «c'è
 * già un lavoro aperto» (409 con il suo id), non «non sono riuscito, riprova»
 * (502), che rimette il pulsante e invita a un terzo avvio.
 *
 * Giro di correzione (22/11) — Mentre /apply scrive, il suo lavoro e' gia'
 * 'applied' (prenotato, con updated_at all'ora della prenotazione). Un avvio in
 * quel momento faceva nascere un lavoro aperto, e il «rimetti pronto»
 * dell'applica cadeva sull'indice (23505): il lavoro pagato restava chiuso.
 * Finche' l'applica puo' ancora girare (120 s, vercel.json) l'avvio si rifiuta.
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

// Il database finto, con lo stato condiviso fra le due richieste.
type Riga = { id: string; seller_id: string; status: string; updated_at?: string };
const APERTI = ['submitting', 'processing', 'ready'];
let righe: Riga[] = [];
let prossimoId = 1;
// Le prime due letture dei lavori aperti si aspettano a vicenda: cosi' le due
// richieste leggono tutte e due PRIMA che una delle due inserisca (la gara).
let lettureAperti = 0;
let apriCancello: () => void = () => undefined;
let cancello: Promise<void> = Promise.resolve();

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
          eq: (_c: string, seller: string) => ({
            in: (_s: string, stati: string[]) => ({
              order: () => ({
                limit: async () => {
                  lettureAperti += 1;
                  if (lettureAperti === 2) apriCancello();
                  if (lettureAperti <= 2) await cancello;
                  const data = righe.filter((r) => r.seller_id === seller && stati.includes(r.status)).map((r) => ({ id: r.id, status: r.status, updated_at: r.updated_at }));
                  return { data, error: null };
                },
              }),
            }),
          }),
        }),
        // Come l'indice del database: un secondo lavoro aperto dello stesso negozio non nasce.
        insert: (v: { seller_id: string; status: string }) => ({
          select: () => ({
            single: async () => {
              if (APERTI.includes(v.status) && righe.some((r) => r.seller_id === v.seller_id && APERTI.includes(r.status))) {
                return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
              }
              const riga = { id: `job-${prossimoId++}`, seller_id: v.seller_id, status: v.status };
              righe.push(riga);
              return { data: { id: riga.id }, error: null };
            },
          }),
        }),
        update: (v: Partial<Riga>) => ({
          eq: async (_c: string, id: string) => {
            righe = righe.map((r) => (r.id === id ? { ...r, ...v } : r));
            return { error: null };
          },
        }),
      };
    },
  }),
}));

const submitBatchMock = vi.fn(async () => ({ id: 'batch_1', processingStatus: 'in_progress', counts: {}, resultsUrl: null }));
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

describe('due avvii insieme del lavoro sul catalogo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    righe = [];
    prossimoId = 1;
    lettureAperti = 0;
    cancello = new Promise<void>((r) => { apriCancello = r; });
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ne parte uno solo, e il secondo sente «hai già un lavoro aperto» con il suo id', async () => {
    const risposte = await Promise.all([POST(richiesta()), POST(richiesta())]);
    const stati = risposte.map((r) => r.status).sort();
    expect(stati).toEqual([200, 409]);

    const secondo = risposte.find((r) => r.status === 409)!;
    const corpo = (await secondo.json()) as { error: { code: string; details?: { jobId?: string } } };
    expect(corpo.error.code).toBe('CONFLICT');
    expect(corpo.error.details?.jobId).toBe('job-1');

    expect(submitBatchMock).toHaveBeenCalledTimes(1);
    expect(righe.filter((r) => APERTI.includes(r.status))).toHaveLength(1);
  });

  it('mentre un\'applicazione gira (lavoro «applied» prenotato 30 s fa) l\'avvio è rifiutato: 409, nessun lotto, nessuna riga', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-22T10:00:00Z'));
    cancello = Promise.resolve();
    righe = [{ id: 'job-a', seller_id: 'seller-1', status: 'applied', updated_at: '2026-11-22T09:59:30Z' }];

    const r = await POST(richiesta());
    expect(r.status).toBe(409);
    const corpo = (await r.json()) as { error: { code: string; message: string; details?: { jobId?: string } } };
    expect(corpo.error.code).toBe('CONFLICT');
    expect(corpo.error.message).toMatch(/applicazione .*in corso/);
    expect(corpo.error.details?.jobId).toBe('job-a');
    expect(submitBatchMock).not.toHaveBeenCalled();
    expect(righe).toHaveLength(1);
  });

  it('passata la durata massima dell\'applica (prenotato 3 minuti fa), il lavoro nuovo parte', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-22T10:00:00Z'));
    cancello = Promise.resolve();
    righe = [{ id: 'job-a', seller_id: 'seller-1', status: 'applied', updated_at: '2026-11-22T09:57:00Z' }];

    const r = await POST(richiesta());
    expect(r.status).toBe(200);
    expect(submitBatchMock).toHaveBeenCalledTimes(1);
  });
});
