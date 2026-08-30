import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * 27/8/2026 (R143 · R155) — LA SPESA DEL LAVORO PIU' COSTOSO SI CONTAVA SOLO SE
 * IL VENDITORE TORNAVA A GUARDARE.
 *
 * Il lotto del catalogo manda fino a duecento richieste al modello in un colpo:
 * è il canale che spende di più. All'avvio si CONTROLLAVA il tetto giornaliero
 * e non si registrava niente; la registrazione stava soltanto nella rotta che
 * legge lo stato del lavoro, dentro il ramo che scatta quando il venditore
 * ri-interroga la pagina E il lotto risulta finito. Chi chiudeva la pagina e
 * non tornava più portava via una spesa che non entrava nel conto di nessuno:
 * cinque avvii all'ora, duecento prodotti l'uno.
 *
 * Adesso alla partenza si impegna una stima, e quando i risultati arrivano si
 * aggiunge solo la differenza fra il costo vero e quella stima — così i soldi
 * si contano una volta sola, ma si contano subito.
 *
 * (R155) Il costo del lotto veniva anche calcolato a tariffa piena, mentre il
 * lotto si paga la metà: il numero registrato era circa il doppio del vero.
 */

const FAKE_USER = { id: 'seller-1', email: 's@x.com' };
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth:
    (h: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) => (req: Request) =>
      h({ user: FAKE_USER, req }),
}));

const PRODUCTS = Array.from({ length: 12 }, (_, i) => ({
  id: `aaaaaaaa-0000-0000-0000-00000000000${i.toString(16)}`,
  name: `Prodotto ${i}`, description: 'x', price: 10, compare_at_price: null,
  unit: 'pezzo', condition: null, stock: 1, status: 'available', category_id: 'el',
  images: [], attributes: {}, tags: [], has_variants: false,
}));
const CATEGORIES = [{ id: 'el', name: 'Elettronica', slug: 'elettronica', parent_id: null }];

const aggiornamenti: Record<string, unknown>[] = [];
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (table: string) => {
      if (table === 'products') {
        return { select: () => ({ eq: () => ({ in: () => ({ order: () => ({ limit: () => Promise.resolve({ data: PRODUCTS, error: null }) }) }) }) }) };
      }
      if (table === 'categories') {
        return { select: () => ({ order: () => Promise.resolve({ data: CATEGORIES, error: null }) }) };
      }
      return {
        insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'job-1' }, error: null }) }) }),
        update: (v: Record<string, unknown>) => {
          aggiornamenti.push(v);
          return { eq: () => Promise.resolve({ error: null }) };
        },
      };
    },
  }),
}));

const submitBatchMock = vi.fn(async () => ({ id: 'batch_1', processingStatus: 'in_progress', counts: {}, resultsUrl: null }));
vi.mock('@/lib/ai/batch', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/batch')>();
  return { ...actual, submitBatch: (...a: unknown[]) => submitBatchMock(...(a as [])) };
});

const registraSpesaMock = vi.fn(async (_eur: number) => undefined);
const controllaTettoMock = vi.fn(async (_feature: string) => undefined);
vi.mock('@/lib/ai/run', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/run')>();
  return {
    ...actual,
    registraSpesaAi: (eur: number) => registraSpesaMock(eur),
    controllaTettoSpesaAi: (feature: string) => controllaTettoMock(feature),
  };
});

import { POST } from '@/app/api/ai/catalog-batch/start/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';
import { stimaCostoLottoEur } from '@/lib/ai/catalogBatch';
import { estimateCostEur, MODELS } from '@/lib/ai/client';

function richiesta(corpo: unknown): never {
  return new Request('http://localhost/api/ai/catalog-batch/start', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  }) as never;
}

describe('il lotto del catalogo mette in conto la spesa quando parte', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    aggiornamenti.length = 0;
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  });

  it('appena il lavoro e partito, la spesa stimata entra nel conto del giorno', async () => {
    const res = await POST(richiesta({ operation: 'improve' }));
    expect(res.status).toBe(200);
    expect(submitBatchMock).toHaveBeenCalledTimes(1);
    expect(
      registraSpesaMock,
      'il lavoro piu costoso del prodotto e partito senza lasciare traccia nel conto della spesa: se il venditore chiude la pagina, quei soldi non li conta nessuno',
    ).toHaveBeenCalledTimes(1);
    const impegnato = registraSpesaMock.mock.calls[0][0];
    expect(impegnato).toBeGreaterThan(0);
    expect(impegnato).toBeCloseTo(stimaCostoLottoEur('improve', PRODUCTS.length), 8);
  });

  it('se il lavoro non parte, non si impegna niente', async () => {
    submitBatchMock.mockRejectedValueOnce(new Error('Anthropic giu'));
    const res = await POST(richiesta({ operation: 'improve' }));
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(registraSpesaMock).not.toHaveBeenCalled();
  });
});

describe('il costo del lotto si conta a meta tariffa, come lo paghiamo', () => {
  it('la stessa chiamata costa la meta se passa dal lotto', () => {
    const uso = { inputTokens: 100_000, outputTokens: 50_000, cacheWriteTokens: 0, cacheReadTokens: 0 };
    const pieno = estimateCostEur(MODELS.fast, uso);
    const lotto = estimateCostEur(MODELS.fast, uso, { batch: true });
    expect(
      lotto,
      'la spesa del lotto viene registrata a tariffa piena: il tetto giornaliero scatta prima del dovuto e la telemetria dice il doppio del vero',
    ).toBeCloseTo(pieno / 2, 10);
  });

  it('la stima del lotto e gia a meta tariffa', () => {
    const stima = stimaCostoLottoEur('translate', 200);
    expect(stima).toBeGreaterThan(0);
    // 200 richieste da 2048 token di uscita a tariffa piena costerebbero il doppio.
    const pienoSoloUscita = estimateCostEur(MODELS.fast, {
      inputTokens: 0, outputTokens: 2048 * 200, cacheWriteTokens: 0, cacheReadTokens: 0,
    });
    expect(stima).toBeLessThan(pienoSoloUscita);
  });
});
