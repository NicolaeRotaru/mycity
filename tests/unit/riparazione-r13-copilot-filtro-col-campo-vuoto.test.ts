import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * R13-002 — Il Copilot su un sottoinsieme grande («tutti i disponibili», 150 su 200) dice il criterio
 * e gli id li sceglie il server. Restava un buco: il modello riempie spesso con null il campo che
 * non usa, e {stato:'available', categoria:null} contava come «categoria scritta e non valida»,
 * quindi sceglieva zero prodotti. Il negoziante riceveva «nessuna modifica» e riprovava, oppure il
 * modello tornava a scrivere gli id uno per uno, che non entrano nel tetto di risposta.
 * Un null e' un campo assente; un criterio scritto e non valido continua a non scegliere niente.
 */

const FAKE_USER = { id: 'seller-1', email: 's@x.com' };
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth: (h: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) => (req: Request) => h({ user: FAKE_USER, req }),
}));

// 200 prodotti: 150 disponibili (i primi), 50 in bozza. 'el' = elettronica, 'tv' = figlia di 'el', 'ab' = abbigliamento.
const PRODUCTS = Array.from({ length: 200 }, (_, i) => ({
  id: `bbbbbbbb-0000-0000-0000-${String(i).padStart(12, '0')}`,
  name: `Prodotto ${i}`, description: '', price: 20, compare_at_price: null, unit: 'pezzo', condition: null,
  stock: 1, status: i < 150 ? 'available' : 'draft', category_id: i % 3 === 0 ? 'el' : i % 3 === 1 ? 'tv' : 'ab',
  images: [], attributes: {}, tags: [], has_variants: false,
}));
const CATEGORIE = [
  { id: 'el', name: 'Elettronica', slug: 'elettronica', parent_id: null },
  { id: 'tv', name: 'Televisori', slug: 'televisori', parent_id: 'el' },
  { id: 'ab', name: 'Abbigliamento', slug: 'abbigliamento', parent_id: null },
];
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (table: string) =>
      table === 'products'
        ? { select: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: PRODUCTS, error: null }) }) }) }) }
        : { select: () => ({ order: () => Promise.resolve({ data: CATEGORIE, error: null }) }) },
  }),
}));

vi.mock('@/lib/ai/moderation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/moderation')>();
  return { ...actual, assertSafeText: async () => undefined };
});

const createMock = vi.fn();
vi.mock('@/lib/ai/client', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/client')>();
  return { ...actual, getAnthropic: () => ({ messages: { create: createMock } }) };
});
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), spesa: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { POST } from '@/app/api/ai/copilot/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

function makeReq(body: unknown): never {
  return new Request('http://localhost/api/ai/copilot', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }) as never;
}

function rispostaDelModello(input: unknown) {
  return {
    content: [{ type: 'tool_use', id: 't', name: 'bulk_edit', input }],
    stop_reason: 'tool_use',
    usage: { input_tokens: 1, output_tokens: 30, cache_creation_input_tokens: null, cache_read_input_tokens: null },
  };
}

describe('un campo del criterio lasciato a null non svuota il sottoinsieme', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  });

  async function chiedi(input: unknown) {
    createMock.mockResolvedValue(rispostaDelModello(input));
    const res = await POST(makeReq({ instruction: 'abbassa del 10% tutti i disponibili' }));
    expect(res.status).toBe(200);
    return (await res.json()) as { reply: string; changes: { product_id: string; patch: { price?: number } }[] };
  }

  it('«tutti i disponibili» con la categoria a null: 150 modifiche, scelte dal server', async () => {
    const json = await chiedi({ reply: 'ok', regola: { filtro: { stato: 'available', categoria: null }, prezzo_percentuale: -10 } });
    expect(json.changes).toHaveLength(150);
    expect(json.changes.every((c) => c.patch.price === 18)).toBe(true);
    expect(new Set(json.changes.map((c) => c.product_id))).toEqual(new Set(PRODUCTS.slice(0, 150).map((p) => p.id)));
  });

  it('«tutta l elettronica» con lo stato a null: la categoria con le sue sottocategorie', async () => {
    const json = await chiedi({ reply: 'ok', regola: { filtro: { stato: null, categoria: 'elettronica' }, prezzo_percentuale: -10 } });
    const attesi = PRODUCTS.filter((p) => p.category_id !== 'ab').map((p) => p.id);
    expect(json.changes.map((c) => c.product_id).sort()).toEqual(attesi.sort());
  });

  it('tutti e due a null non sono un criterio, e uno scritto male resta zero', async () => {
    expect((await chiedi({ reply: 'ok', regola: { filtro: { stato: null, categoria: null }, prezzo_percentuale: -10 } })).changes).toHaveLength(0);
    expect((await chiedi({ reply: 'ok', regola: { filtro: { stato: 'Available', categoria: null }, prezzo_percentuale: -10 } })).changes).toHaveLength(0);
    expect((await chiedi({ reply: 'ok', regola: { filtro: { stato: null, categoria: 'giardino' }, prezzo_percentuale: -10 } })).changes).toHaveLength(0);
  });
});
