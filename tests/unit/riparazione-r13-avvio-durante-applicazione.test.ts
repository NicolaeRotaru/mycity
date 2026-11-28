import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * R13-001 · R13-009 — Un avvio del lavoro AI sul catalogo mentre un'applicazione
 * e' in corso.
 *
 * /apply segna il lavoro «applicato» quando comincia e, se un guasto di
 * passaggio lo lascia ripetibile, lo rimette «pronto». Se in mezzo la rotta di
 * avvio fa nascere un lavoro nuovo, il database (640: un solo lavoro aperto per
 * negozio) rifiuta il «pronto» con 23505 e il lavoro pagato resta chiuso.
 *
 * Il database finto qui sotto ha lo stato condiviso e l'indice della 640. La
 * gara: /apply prenota, parte un avvio, /apply rimette «pronto». L'avvio deve
 * aspettare (409), e il «pronto» deve passare. Poi i casi che non devono
 * cambiare: un'applicazione finita (col segno di fine della 750) o vecchia non
 * ferma niente, e senza la colonna l'avvio aspetta lo stesso, contando i 120 s
 * dall'inizio dell'applicazione.
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

type Riga = {
  id: string;
  seller_id: string;
  status: string;
  created_at: string;
  updated_at: string;
  applicazione_finita_il: string | null;
  [k: string]: unknown;
};
const APERTI = ['submitting', 'processing', 'ready'];
let righe: Riga[] = [];
let prossimoId = 1;
/** false = la 750 non e' applicata: chi nomina la colonna riceve l'errore di PostgREST. */
let colonnaPresente = true;
let codiceColonnaAssente = '42703';
/** Un guasto qualunque sulla lettura dei lavori applicati. */
let guastoApplicati: { code: string } | null = null;
const COLONNA = 'applicazione_finita_il';

const duplicato = { code: '23505', message: 'duplicate key value violates unique constraint' };
const violaIndice = (r: Pick<Riga, 'id' | 'seller_id' | 'status'>) =>
  APERTI.includes(r.status) && righe.some((x) => x.id !== r.id && x.seller_id === r.seller_id && APERTI.includes(x.status));

function lavori() {
  const filtri: Array<(r: Riga) => boolean> = [];
  const filtriStato: string[][] = [];
  let azione: 'select' | 'insert' | 'update' = 'select';
  let colonne = '*';
  let valori: Partial<Riga> = {};
  let ordine: { colonna: string; crescente: boolean } | null = null;
  let quanti: number | null = null;

  const esegui = async (): Promise<{ data: unknown; error: unknown }> => {
    const nomina = colonne.includes(COLONNA) || Object.keys(valori).includes(COLONNA);
    if (!colonnaPresente && nomina) return { data: null, error: { code: codiceColonnaAssente, message: 'colonna sconosciuta' } };
    if (azione === 'insert') {
      const adesso = new Date().toISOString();
      const riga = {
        id: `job-${prossimoId++}`, created_at: adesso, updated_at: adesso, applicazione_finita_il: null,
        ...valori,
      } as Riga;
      if (violaIndice(riga)) return { data: null, error: duplicato };
      righe.push(riga);
      return { data: [{ id: riga.id }], error: null };
    }
    const scelte = righe.filter((r) => filtri.every((f) => f(r)));
    if (azione === 'update') {
      for (const r of scelte) if (violaIndice({ ...r, ...valori })) return { data: null, error: duplicato };
      righe = righe.map((r) => (scelte.includes(r) ? { ...r, ...valori } : r));
      return { data: scelte.map((r) => ({ id: r.id })), error: null };
    }
    if (guastoApplicati && filtriStato.some((s) => s.includes('applied'))) return { data: null, error: guastoApplicati };
    let fuori = [...scelte];
    if (ordine) {
      const { colonna, crescente } = ordine;
      fuori.sort((a, b) => (String(a[colonna]) < String(b[colonna]) ? -1 : 1) * (crescente ? 1 : -1));
    }
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
      if (c === 'status') filtriStato.push(vs);
      filtri.push((r) => vs.includes(String(r[c])));
      return q;
    },
    order: (c: string, o?: { ascending?: boolean }) => { ordine = { colonna: c, crescente: o?.ascending !== false }; return q; },
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
import { getAdminSupabase } from '@/lib/supabase/server';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

const ADESSO = new Date('2026-11-22T10:00:00.000Z');
const fa = (ms: number) => new Date(ADESSO.getTime() - ms).toISOString();

const richiesta = () =>
  new Request('http://localhost/api/ai/catalog-batch/start', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ operation: 'improve' }),
  }) as never;

const lavoroPronto = (id: string, extra: Partial<Riga> = {}): Riga => ({
  id, seller_id: FAKE_USER.id, status: 'ready', created_at: fa(3_600_000), updated_at: fa(600_000),
  applicazione_finita_il: null, ...extra,
});

// I passi di /apply sul lavoro, con le stesse scritture della rotta.
const admin = () => getAdminSupabase() as unknown as { from: (t: string) => ReturnType<typeof lavori> };
const prenota = (id: string) =>
  admin().from('catalog_ai_jobs')
    .update({ status: 'applied', updated_at: new Date().toISOString() })
    .eq('id', id).eq('seller_id', FAKE_USER.id).eq('status', 'ready')
    .select('id') as unknown as Promise<{ data: unknown[]; error: unknown }>;
const rimettiPronto = (id: string) =>
  admin().from('catalog_ai_jobs')
    .update({ status: 'ready', updated_at: new Date().toISOString() })
    .eq('id', id).eq('seller_id', FAKE_USER.id) as unknown as Promise<{ error: unknown }>;

const aperti = () => righe.filter((r) => r.seller_id === FAKE_USER.id && APERTI.includes(r.status));

describe('un avvio mentre un lavoro sul catalogo si sta applicando', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(ADESSO);
    vi.clearAllMocks();
    righe = [];
    prossimoId = 1;
    colonnaPresente = true;
    codiceColonnaAssente = '42703';
    guastoApplicati = null;
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('la gara: /apply prenota, l avvio aspetta (409) e il «pronto» di /apply passa', async () => {
    righe = [lavoroPronto('job-pronto')];
    const { data: prenotato } = await prenota('job-pronto');
    expect(prenotato).toHaveLength(1);

    vi.setSystemTime(new Date(ADESSO.getTime() + 5_000));
    const risposta = await POST(richiesta());
    expect(risposta.status).toBe(409);
    const corpo = (await risposta.json()) as { error: { code: string; details?: { jobId?: string } } };
    expect(corpo.error.code).toBe('CONFLICT');
    expect(corpo.error.details?.jobId).toBe('job-pronto');
    expect(submitBatchMock).not.toHaveBeenCalled();
    expect(registraSpesaMock).not.toHaveBeenCalled();

    // Un guasto di passaggio: /apply rimette il lavoro «pronto», e il database lo accetta.
    const { error } = await rimettiPronto('job-pronto');
    expect(error).toBeNull();
    expect(righe.find((r) => r.id === 'job-pronto')?.status).toBe('ready');
    expect(aperti()).toHaveLength(1);
  });

  it('un applicazione finita (col segno di fine) non ferma l avvio', async () => {
    righe = [lavoroPronto('job-fatto', { status: 'applied', updated_at: fa(5_000), applicazione_finita_il: fa(1_000) })];
    const risposta = await POST(richiesta());
    expect(risposta.status).toBe(200);
    expect(submitBatchMock).toHaveBeenCalledTimes(1);
  });

  it('un lavoro applicato senza segno ma di piu di 120 s fa (righe di prima della 750) non ferma l avvio', async () => {
    righe = [lavoroPronto('job-vecchio', { status: 'applied', updated_at: fa(121_000), applicazione_finita_il: null })];
    const risposta = await POST(richiesta());
    expect(risposta.status).toBe(200);
    expect(submitBatchMock).toHaveBeenCalledTimes(1);
  });

  it.each(['42703', 'PGRST204'])('senza la colonna (errore %s) l avvio aspetta lo stesso (409)', async (codice) => {
    colonnaPresente = false;
    codiceColonnaAssente = codice;
    righe = [lavoroPronto('job-in-corso', { status: 'applied', updated_at: fa(5_000) })];
    const risposta = await POST(richiesta());
    expect(risposta.status).toBe(409);
    expect(submitBatchMock).not.toHaveBeenCalled();
    expect(aperti()).toHaveLength(0);
  });

  it('se la lettura dei lavori applicati cade per un altro guasto, non parte niente', async () => {
    guastoApplicati = { code: '57014' };
    const risposta = await POST(richiesta());
    expect(risposta.status).toBe(502);
    expect(submitBatchMock).not.toHaveBeenCalled();
    expect(righe).toHaveLength(0);
  });
});
