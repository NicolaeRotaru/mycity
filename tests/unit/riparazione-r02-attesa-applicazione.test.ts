import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * R02-004 — L'attesa per un'applicazione del catalogo ancora in corso.
 *
 * La rotta di avvio legge il segno di fine dell'applicazione
 * (catalog_ai_jobs.applicazione_finita_il), ma nessuna migrazione crea quella
 * colonna: la lettura cade con 42703 (o PGRST204) e prima l'avvio andava avanti,
 * cioe' l'attesa non scattava mai. Adesso si rilegge senza la colonna e si
 * aspetta (409) finche' l'ultimo lavoro applicato ha meno di 120 s.
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

type Riga = { id: string; seller_id: string; status: string; created_at: string; updated_at: string; [k: string]: unknown };
const COLONNA = 'applicazione_finita_il';
let righe: Riga[] = [];
let prossimoId = 1;
/** Il codice con cui il database rifiuta chi nomina la colonna che non c'e'. */
let codiceColonnaAssente = '42703';
/** Un guasto qualunque sulla seconda lettura, quella senza la colonna. */
let guastoRilettura: { code: string } | null = null;
const lettureApplicati: string[] = [];

function lavori() {
  const filtri: Array<(r: Riga) => boolean> = [];
  let applicati = false;
  let azione: 'select' | 'insert' | 'update' = 'select';
  let colonne = '*';
  let valori: Partial<Riga> = {};
  let quanti: number | null = null;

  const esegui = async (): Promise<{ data: unknown; error: unknown }> => {
    if (azione === 'select' && colonne.includes(COLONNA)) {
      if (applicati) lettureApplicati.push(colonne);
      return { data: null, error: { code: codiceColonnaAssente, message: 'colonna sconosciuta' } };
    }
    if (azione === 'insert') {
      const adesso = new Date().toISOString();
      const riga = { id: `job-${prossimoId++}`, created_at: adesso, updated_at: adesso, ...valori } as Riga;
      righe.push(riga);
      return { data: [{ id: riga.id }], error: null };
    }
    const scelte = righe.filter((r) => filtri.every((f) => f(r)));
    if (azione === 'update') {
      righe = righe.map((r) => (scelte.includes(r) ? { ...r, ...valori } : r));
      return { data: scelte.map((r) => ({ id: r.id })), error: null };
    }
    if (applicati) {
      lettureApplicati.push(colonne);
      if (guastoRilettura) return { data: null, error: guastoRilettura };
    }
    let fuori = [...scelte].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
    if (quanti !== null) fuori = fuori.slice(0, quanti);
    const nomi = colonne.split(',').map((c) => c.trim());
    return { data: fuori.map((r) => Object.fromEntries(nomi.map((n) => [n, r[n]]))), error: null };
  };

  const q = {
    select: (c?: string) => { if (azione === 'select') colonne = c ?? '*'; return q; },
    insert: (v: Partial<Riga>) => { azione = 'insert'; valori = v; return q; },
    update: (v: Partial<Riga>) => { azione = 'update'; valori = v; return q; },
    eq: (c: string, v: unknown) => { filtri.push((r) => r[c] === v); return q; },
    in: (c: string, vs: string[]) => {
      if (c === 'status' && vs.length === 1 && vs[0] === 'applied') applicati = true;
      filtri.push((r) => vs.includes(String(r[c])));
      return q;
    },
    order: () => q,
    limit: (n: number) => { quanti = n; return q; },
    single: async () => {
      const { data, error } = await esegui();
      return { data: Array.isArray(data) ? (data[0] ?? null) : data, error };
    },
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => esegui().then(ok, ko),
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
      return lavori();
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

const ADESSO = new Date('2026-11-27T10:00:00.000Z');
const fa = (ms: number) => new Date(ADESSO.getTime() - ms).toISOString();

const richiesta = () =>
  new Request('http://localhost/api/ai/catalog-batch/start', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ operation: 'improve' }),
  }) as never;

const applicato = (id: string, aggiornatoFaMs: number): Riga => ({
  id, seller_id: FAKE_USER.id, status: 'applied', created_at: fa(3_600_000), updated_at: fa(aggiornatoFaMs),
});

describe('senza la colonna del segno di fine, l avvio aspetta l applicazione in corso', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(ADESSO);
    vi.clearAllMocks();
    righe = [];
    prossimoId = 1;
    codiceColonnaAssente = '42703';
    guastoRilettura = null;
    lettureApplicati.length = 0;
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it.each(['42703', 'PGRST204'])('colonna assente (%s), applicazione cominciata 5 s fa: 409 e nessun lotto', async (codice) => {
    codiceColonnaAssente = codice;
    righe = [applicato('job-in-corso', 5_000)];
    const risposta = await POST(richiesta());
    expect(risposta.status).toBe(409);
    const corpo = (await risposta.json()) as { error: { code: string; details?: { jobId?: string; status?: string } } };
    expect(corpo.error.code).toBe('CONFLICT');
    expect(corpo.error.details).toMatchObject({ jobId: 'job-in-corso', status: 'applied' });
    expect(submitBatchMock).not.toHaveBeenCalled();
    expect(registraSpesaMock).not.toHaveBeenCalled();
    expect(righe).toHaveLength(1);
    expect(lettureApplicati).toEqual([`id, updated_at, ${COLONNA}`, 'id, updated_at']);
  });

  it('colonna assente, applicazione cominciata piu di 120 s fa: l avvio parte', async () => {
    righe = [applicato('job-vecchio', 121_000)];
    const risposta = await POST(richiesta());
    expect(risposta.status).toBe(200);
    expect(submitBatchMock).toHaveBeenCalledTimes(1);
  });

  it('colonna assente e nessun lavoro applicato: l avvio parte', async () => {
    const risposta = await POST(richiesta());
    expect(risposta.status).toBe(200);
    expect(submitBatchMock).toHaveBeenCalledTimes(1);
  });

  it('se cade anche la rilettura senza la colonna, non parte niente', async () => {
    guastoRilettura = { code: '57014' };
    righe = [applicato('job-vecchio', 121_000)];
    const risposta = await POST(richiesta());
    expect(risposta.status).toBe(502);
    expect(submitBatchMock).not.toHaveBeenCalled();
    expect(righe).toHaveLength(1);
  });
});
