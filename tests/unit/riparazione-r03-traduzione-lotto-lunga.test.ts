import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * R03-012 — Se si riaccende «Traduci», una descrizione lunga tornava tradotta
 * solo all'inizio. Dal modulo la rotta di traduzione la rifiuta gia' (R04-016);
 * restava il lavoro sul catalogo: il lotto manda al modello la descrizione
 * tagliata a 4000 caratteri, e la traduzione dell'inizio, applicata, prendeva
 * il posto della descrizione intera. Adesso una scheda troppo lunga non entra
 * nel lavoro di traduzione, e la risposta dice quante sono rimaste fuori.
 */

const FAKE_USER = { id: 'seller-1', email: 's@x.com' };
vi.mock('@/lib/funzioni-al-lancio', async (originale) => ({
  ...((await originale()) as Record<string, unknown>),
  AI_NEGOZI_ACCESA: true,
  TRADUCI_ACCESO: true,
}));
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth:
    (h: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) => (req: Request) =>
      h({ user: FAKE_USER, req }),
}));
const prodotto = (id: string, description: string) => ({
  id, name: 'Lampada da tavolo', description, price: 30, compare_at_price: null,
  unit: 'pezzo', condition: null, stock: 1, status: 'available', category_id: 'casa',
  images: [], attributes: {}, tags: [], has_variants: false,
});
const CORTO = prodotto('aaaaaaaa-0000-0000-0000-000000000001', 'Lampada in ottone, luce calda.');
const LUNGO = prodotto('aaaaaaaa-0000-0000-0000-000000000002', 'Storia della bottega. '.repeat(300));
const stato = vi.hoisted(() => ({ prodotti: [] as unknown[], inseriti: [] as Record<string, unknown>[] }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (table: string) => {
      if (table === 'products') {
        return { select: () => ({ eq: () => ({ in: () => ({ order: () => ({ limit: () => Promise.resolve({ data: stato.prodotti, error: null }) }) }) }) }) };
      }
      if (table === 'categories') return { select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) };
      return {
        select: () => ({ eq: () => ({ in: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }) }),
        insert: (v: Record<string, unknown>) => {
          stato.inseriti.push(v);
          return { select: () => ({ single: () => Promise.resolve({ data: { id: 'job-1' }, error: null }) }) };
        },
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
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

const avvia = (operation: string) =>
  POST(
    new Request('http://localhost/api/ai/catalog-batch/start', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation, ...(operation === 'translate' ? { targetLang: 'en' } : {}) }),
    }) as never,
  );

const idInviati = () => (submitBatchMock.mock.calls[0]?.[0] as { custom_id: string }[] | undefined ?? []).map((r) => r.custom_id);

describe('la traduzione del catalogo non traduce solo l\'inizio di una descrizione lunga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stato.inseriti.length = 0;
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    submitBatchMock.mockResolvedValue({ id: 'msgbatch_1' });
  });

  it('una scheda lunga resta fuori dal lotto di traduzione, e la risposta lo dice', async () => {
    stato.prodotti = [CORTO, LUNGO];
    const res = await avvia('translate');
    expect(res.status).toBe(200);
    expect(idInviati()).toEqual([CORTO.id]);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.total).toBe(1);
    expect(json.esclusiTroppoLunghi).toBe(1);
    expect(stato.inseriti[0]?.total).toBe(1);
  });

  it('solo schede lunghe: non parte niente e il negoziante legge perche\'', async () => {
    stato.prodotti = [LUNGO];
    const res = await avvia('translate');
    expect(res.status).toBe(400);
    expect(submitBatchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(await res.json())).toMatch(/troppo lunghe per la traduzione/);
  });

  it('le altre operazioni prendono anche le schede lunghe, come prima', async () => {
    stato.prodotti = [CORTO, LUNGO];
    const res = await avvia('redescribe');
    expect(res.status).toBe(200);
    expect(idInviati()).toEqual([CORTO.id, LUNGO.id]);
    expect((await res.json()) as Record<string, unknown>).not.toHaveProperty('esclusiTroppoLunghi');
  });

  it('la pagina del lavoro sul catalogo dice al negoziante quante schede sono rimaste fuori (prova leggera)', () => {
    const pagina = readFileSync(join(process.cwd(), 'app', 'seller', 'products', 'ai-batch', 'page.tsx'), 'utf8');
    expect(pagina).toMatch(/data\.esclusiTroppoLunghi/);
    expect(pagina).toMatch(/Traducili a mano/);
  });
});
