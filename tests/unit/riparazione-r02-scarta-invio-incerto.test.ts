import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InternalServerError } from '@anthropic-ai/sdk';

/**
 * R02-003 · R02-002 — Dopo un 500/502/504 del fornitore all'invio di un lotto
 * (o un invio rimasto senza risposta) la riga resta «in invio», senza lotto,
 * col motivo «invio senza risposta». L'avvio rispondeva 409 e la rotta cancel
 * scartava solo un lavoro pronto: il negozio restava fermo fino a 24 ore.
 *
 * Adesso il lavoro «forse partito» si scarta, ma solo:
 *  - dopo 3 minuti dalla nascita (la rotta di avvio vive al massimo 120 s, e
 *    prima potrebbe ancora agganciare il lotto);
 *  - se e' ancora «in invio», senza lotto, con quel motivo: un lotto agganciato
 *    o un «partito ma non agganciato» col suo id non si perde;
 *  - lasciando la riga, annullata, con la data e un motivo che dice che il
 *    lotto potrebbe essere partito.
 * Il database finto valuta davvero i filtri delle due rotte su righe condivise.
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
const APERTI = ['submitting', 'processing', 'ready'];
let lavori: Riga[] = [];
let prossimoId = 1;

const comeData = (v: unknown) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? Date.parse(v) : v);

/** Una query di supabase-js, ridotta a quello che usano le due rotte, sulle righe di `lavori`. */
function lavoriQuery() {
  const filtri: ((r: Riga) => boolean)[] = [];
  let azione: 'select' | 'insert' | 'update' = 'select';
  let valori: Riga = {};
  let ordine: { col: string; asc: boolean } | null = null;
  let limite: number | null = null;
  let unaSola = false;
  const esegui = () => {
    if (azione === 'insert') {
      if (APERTI.includes(String(valori.status)) && lavori.some((r) => r.seller_id === valori.seller_id && APERTI.includes(String(r.status)))) {
        return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
      }
      const riga: Riga = { batch_id: null, error: null, ...valori, id: `job-${prossimoId++}`, created_at: new Date().toISOString() };
      lavori.push(riga);
      return { data: unaSola ? riga : [riga], error: null };
    }
    const scelte = lavori.filter((r) => filtri.every((f) => f(r)));
    if (azione === 'update') {
      lavori = lavori.map((r) => (scelte.includes(r) ? { ...r, ...valori } : r));
      const dopo = lavori.filter((r) => scelte.some((s) => s.id === r.id));
      return { data: dopo, error: null };
    }
    let out = [...scelte];
    if (ordine) {
      const { col, asc } = ordine;
      out.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1));
    }
    if (limite !== null) out = out.slice(0, limite);
    return { data: unaSola ? out[0] ?? null : out, error: null };
  };
  const q = {
    select: () => q,
    insert: (v: Riga) => { azione = 'insert'; valori = v; return q; },
    update: (v: Riga) => { azione = 'update'; valori = v; return q; },
    eq: (c: string, v: unknown) => { filtri.push((r) => r[c] === v); return q; },
    in: (c: string, vs: unknown[]) => { filtri.push((r) => vs.includes(r[c])); return q; },
    is: (c: string, v: unknown) => { filtri.push((r) => (r[c] ?? null) === v); return q; },
    lt: (c: string, v: unknown) => { filtri.push((r) => (comeData(r[c]) as number) < (comeData(v) as number)); return q; },
    order: (c: string, o?: { ascending?: boolean }) => { ordine = { col: c, asc: o?.ascending ?? true }; return q; },
    limit: (n: number) => { limite = n; return q; },
    single: () => { unaSola = true; return q; },
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(esegui()).then(ok, ko),
  };
  return q;
}

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (table: string) => {
      if (table === 'products') {
        return { select: () => ({ eq: () => ({ in: () => ({ order: () => ({ limit: () => Promise.resolve({ data: PRODUCTS, error: null }) }) }) }) }) };
      }
      if (table === 'categories') {
        return { select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) };
      }
      return lavoriQuery();
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

import { POST as avvia } from '@/app/api/ai/catalog-batch/start/route';
import { POST as scartaRotta } from '@/app/api/ai/catalog-batch/cancel/route';
import { INVIO_SENZA_RISPOSTA } from '@/lib/ai/batch';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

const avvio = () =>
  avvia(new Request('http://localhost/api/ai/catalog-batch/start', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ operation: 'improve' }),
  }) as never);
const scarta = (jobId: string) =>
  scartaRotta(new Request('http://localhost/api/ai/catalog-batch/cancel', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobId }),
  }) as never);
const messaggio = async (res: Response) => ((await res.json()) as { error?: { message?: string } }).error?.message ?? '';
const erroreDelFornitore = (status: number) =>
  new InternalServerError(status, { type: 'error', error: { type: 'api_error', message: 'x' } }, `${status}`, new Headers());

const ADESSO = new Date('2026-11-21T10:00:00Z');
const minutiFa = (m: number) => new Date(ADESSO.getTime() - m * 60_000).toISOString();

describe('un lavoro sul catalogo «forse partito» si scarta', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(ADESSO);
    vi.clearAllMocks();
    lavori = [];
    prossimoId = 1;
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  });
  afterEach(() => { vi.useRealTimers(); });

  it('dopo un 502 all\'invio: passati 3 minuti si scarta, la riga resta come traccia, e il negozio riparte', async () => {
    submitBatchMock.mockRejectedValueOnce(erroreDelFornitore(502));
    const primo = await avvio();
    expect(primo.status).toBe(503);
    expect(await messaggio(primo)).toMatch(/scartarlo/);
    expect(lavori).toHaveLength(1);
    const [riga] = lavori;
    expect(riga).toMatchObject({ status: 'submitting', batch_id: null, error: INVIO_SENZA_RISPOSTA });
    const nato = riga.created_at;

    // Il secondo avvio e' fermato, ma sa che il lavoro si potra' scartare.
    const secondo = await avvio();
    expect(secondo.status).toBe(409);
    expect(await messaggio(secondo)).toMatch(/scartarlo/);

    // Dopo un minuto no: la rotta di avvio potrebbe ancora agganciare il lotto.
    vi.setSystemTime(new Date(ADESSO.getTime() + 60_000));
    expect((await scarta(String(riga.id))).status).toBe(409);
    expect(lavori[0].status).toBe('submitting');

    // Dopo 4 minuti si'.
    vi.setSystemTime(new Date(ADESSO.getTime() + 4 * 60_000));
    const scartato = await scarta(String(riga.id));
    expect(scartato.status).toBe(200);
    expect(lavori).toHaveLength(1);
    expect(lavori[0].status).toBe('canceled');
    expect(lavori[0].created_at).toBe(nato);
    expect(String(lavori[0].error)).toMatch(/potrebbe essere partito/);

    submitBatchMock.mockResolvedValueOnce({ id: 'batch_2', processingStatus: 'in_progress', counts: {}, resultsUrl: null });
    const terzo = await avvio();
    expect(terzo.status).toBe(200);
    expect(lavori.filter((r) => APERTI.includes(String(r.status)))).toHaveLength(1);
  });

  it('un lotto partito ma non agganciato (col suo id) non si scarta: lo stato lo aggancia', async () => {
    lavori = [{ id: 'job-x', seller_id: 'seller-1', status: 'submitting', batch_id: null, error: 'lotto partito ma non agganciato: msgbatch_x', created_at: minutiFa(10) }];
    expect((await scarta('job-x')).status).toBe(409);
    expect(lavori[0]).toMatchObject({ status: 'submitting', error: 'lotto partito ma non agganciato: msgbatch_x' });
  });

  it('un lotto agganciato nel frattempo, o in corso, non si scarta', async () => {
    lavori = [
      { id: 'job-a', seller_id: 'seller-1', status: 'submitting', batch_id: 'msgbatch_a', error: INVIO_SENZA_RISPOSTA, created_at: minutiFa(10) },
      { id: 'job-b', seller_id: 'seller-1', status: 'processing', batch_id: 'msgbatch_b', error: null, created_at: minutiFa(10) },
    ];
    expect((await scarta('job-a')).status).toBe(409);
    expect((await scarta('job-b')).status).toBe(409);
    expect(lavori.map((r) => r.status)).toEqual(['submitting', 'processing']);
  });

  it('il lavoro forse partito di un altro negozio non si scarta', async () => {
    lavori = [{ id: 'job-o', seller_id: 'seller-2', status: 'submitting', batch_id: null, error: INVIO_SENZA_RISPOSTA, created_at: minutiFa(10) }];
    expect((await scarta('job-o')).status).toBe(409);
    expect(lavori[0].status).toBe('submitting');
  });

  it('un lavoro pronto si scarta come prima', async () => {
    lavori = [{ id: 'job-r', seller_id: 'seller-1', status: 'ready', batch_id: 'msgbatch_r', error: null, created_at: minutiFa(1) }];
    expect((await scarta('job-r')).status).toBe(200);
    expect(lavori[0].status).toBe('canceled');
  });
});
