import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';

/**
 * R20-008 — Con un solo timeout del conto condiviso della spesa AI il negoziante
 * leggeva «Budget AI giornaliero esaurito. Riprova domani.».
 *
 * Quando la spesa di oggi non si sa (il conto condiviso non risponde: un
 * timeout, la pausa del circuito) la decisione dice `spesa_sconosciuta`, ma
 * `controllaTettoSpesaAi` la trasformava nel freno del budget (`tetto_spesa`):
 * stesso testo del tetto vero, «riprova domani», e il lotto del catalogo chiuso
 * «annullato per tetto raggiunto». Adesso e' un errore temporaneo suo: 503,
 * «riprova fra qualche minuto». Il tetto vero resta com'era.
 *
 * Il conto finto qui sotto dice quanto si e' speso oggi: un numero, oppure NaN
 * («non lo so», come dopo un timeout).
 */

const stato = vi.hoisted(() => ({
  spesaCents: 0 as number,
  aggiornamenti: [] as Array<Record<string, unknown>>,
  creaMessaggio: null as unknown as Mock<(...a: unknown[]) => Promise<unknown>>,
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), spesa: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/ai/tettoSpesa', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/tettoSpesa')>();
  return {
    ...actual,
    spesaDiOggiCents: async () => stato.spesaCents,
    ultimaSpesaNotaCents: () => 0,
    statoContoCondiviso: () => ({ condiviso: true, permanente: false, motivo: '', daMinuti: 0 }),
    aggiungiSpesaCents: async () => undefined,
  };
});

vi.mock('@/lib/ai/client', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/client')>();
  return {
    ...actual,
    getAnthropic: () => ({ messages: { create: (...a: unknown[]) => stato.creaMessaggio(...a) } }),
    segnalaModelloRitirato: () => false,
  };
});

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
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    rpc: async () => ({ data: null, error: { message: 'conto finto: non usato qui' } }),
    from: (table: string) => {
      if (table === 'products') {
        return { select: () => ({ eq: () => ({ in: () => ({ order: () => ({ limit: () => Promise.resolve({ data: PRODUCTS, error: null }) }) }) }) }) };
      }
      if (table === 'categories') return { select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) };
      return {
        select: () => ({ eq: () => ({ in: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }) }),
        insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'job-1' }, error: null }) }) }),
        update: (v: Record<string, unknown>) => {
          stato.aggiornamenti.push(v);
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

import { controllaTettoSpesaAi, mapAiError, runMessage, AiCallError } from '@/lib/ai/run';
import { MODELS } from '@/lib/ai/client';
import { POST } from '@/app/api/ai/catalog-batch/start/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

const richiesta = () =>
  new Request('http://localhost/api/ai/catalog-batch/start', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ operation: 'improve' }),
  }) as never;

async function testoDi(res: Response): Promise<string> {
  return JSON.stringify(await res.json());
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-26T10:00:00+01:00'));
  // Sul computer di chi sviluppa: la prova non dipende da dove gira.
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('VERCEL_ENV', '');
  vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
  vi.stubEnv('AI_GLOBAL_DAILY_BUDGET_EUR', '20');
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  stato.spesaCents = 0;
  stato.aggiornamenti.length = 0;
  stato.creaMessaggio = vi.fn(async () => ({
    content: [{ type: 'text', text: 'ok' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 10 },
  }));
  submitBatchMock.mockReset();
  submitBatchMock.mockResolvedValue({ id: 'batch-1' });
  __resetRateLimitBuckets();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('la spesa di oggi che non si sa non e\' il budget finito', () => {
  it('il conto che non risponde da\' un errore temporaneo: 503, «riprova fra qualche minuto», mai «domani»', async () => {
    stato.spesaCents = Number.NaN;
    const errore = await controllaTettoSpesaAi('ai-description', 10).then(
      () => null,
      (e: unknown) => e,
    );
    expect(errore).toBeInstanceOf(AiCallError);
    expect((errore as AiCallError).status).toBe(503);
    expect((errore as AiCallError).motivo).not.toBe('tetto_spesa');

    const risposta = mapAiError(errore, 'ai-description');
    expect(risposta.status).toBe(503);
    const testo = await testoDi(risposta);
    expect(testo).toMatch(/qualche minuto/);
    expect(testo).not.toMatch(/Budget/i);
    expect(testo).not.toMatch(/domani/i);
  });

  it('runMessage non chiama il modello e non dice «budget esaurito»', async () => {
    stato.spesaCents = Number.NaN;
    const errore = await runMessage({
      feature: 'ai-description',
      model: MODELS.fast,
      max_tokens: 100,
      messages: [{ role: 'user', content: 'ciao' }],
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(errore).toBeInstanceOf(AiCallError);
    expect((errore as AiCallError).motivo).not.toBe('tetto_spesa');
    expect(stato.creaMessaggio).not.toHaveBeenCalled();
    expect(await testoDi(mapAiError(errore, 'ai-description'))).not.toMatch(/Riprova domani/);
  });

  it('il tetto vero, invece, dice ancora «Budget AI giornaliero esaurito»', async () => {
    stato.spesaCents = 2000; // 20 € su 20 €
    const errore = await controllaTettoSpesaAi('ai-description', 10).then(
      () => null,
      (e: unknown) => e,
    );
    expect((errore as AiCallError).motivo).toBe('tetto_spesa');
    const risposta = mapAiError(errore, 'ai-description');
    expect(risposta.status).toBe(503);
    expect(await testoDi(risposta)).toMatch(/Budget AI giornaliero esaurito/);
  });
});

describe('il lotto del catalogo con la spesa che non si sa', () => {
  it('non si chiude «annullato per tetto»: 503 con «riprova fra qualche minuto», e il lavoro non parte', async () => {
    stato.spesaCents = Number.NaN;
    const res = await POST(richiesta());
    expect(res.status).toBe(503);
    const testo = await testoDi(res);
    expect(testo).toMatch(/qualche minuto/);
    expect(testo).not.toMatch(/Budget/i);
    expect(stato.aggiornamenti.some((a) => a.status === 'canceled')).toBe(false);
    expect(stato.aggiornamenti.some((a) => /tetto/i.test(String(a.error ?? '')))).toBe(false);
    // La riga nata «in invio» si chiude: un nuovo avvio non resta bloccato.
    expect(stato.aggiornamenti.some((a) => a.status === 'failed')).toBe(true);
    expect(submitBatchMock).not.toHaveBeenCalled();
  });

  it('con il tetto vero raggiunto resta com\'era: annullato, «Budget AI giornaliero esaurito»', async () => {
    stato.spesaCents = 2000;
    const res = await POST(richiesta());
    expect(res.status).toBe(503);
    expect(await testoDi(res)).toMatch(/Budget AI giornaliero esaurito/);
    expect(stato.aggiornamenti.some((a) => a.status === 'canceled')).toBe(true);
    expect(submitBatchMock).not.toHaveBeenCalled();
  });
});
