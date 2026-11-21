import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Il Copilot su un sottoinsieme grande («tutti i disponibili», 150 su 200) scriveva gli id uno per
 * uno e il negoziante leggeva «Riprova». Ora il modello dice il criterio (stato e/o categoria) e gli
 * id li sceglie il server; le voci singole oltre le 40 il server le taglia.
 */

const FAKE_USER = { id: 'seller-1', email: 's@x.com' };
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth: (h: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) => (req: Request) => h({ user: FAKE_USER, req }),
}));

// 200 prodotti: 150 disponibili (i primi), 50 in bozza. 'el' = elettronica, 'tv' = figlia di 'el', 'ab' = abbigliamento.
const PRODUCTS = Array.from({ length: 200 }, (_, i) => ({
  id: `aaaaaaaa-0000-0000-0000-${String(i).padStart(12, '0')}`,
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


describe('un sottoinsieme grande del catalogo si dice con un criterio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  });

  async function chiedi(input: unknown) {
    createMock.mockResolvedValue(rispostaDelModello(input));
    const res = await POST(makeReq({ instruction: 'x' }));
    expect(res.status).toBe(200);
    return (await res.json()) as { changes: { product_id: string; patch: { price?: number } }[] };
  }

  it('«tutti i disponibili»: 150 modifiche, gli id li mette il server', async () => {
    const json = await chiedi({ reply: 'ok', regola: { filtro: { stato: 'available' }, prezzo_percentuale: -10 } });
    expect(json.changes).toHaveLength(150);
    expect(json.changes.every((c) => c.patch.price === 18)).toBe(true);
    expect(new Set(json.changes.map((c) => c.product_id))).toEqual(new Set(PRODUCTS.slice(0, 150).map((p) => p.id)));
  });

  it('per categoria le sottocategorie seguono la madre, e si puo unire allo stato', async () => {
    const json = await chiedi({ reply: 'ok', regola: { filtro: { categoria: 'Elettronica', stato: 'draft' }, prezzo_percentuale: -10 } });
    const attesi = PRODUCTS.filter((p) => p.status === 'draft' && p.category_id !== 'ab').map((p) => p.id);
    expect(json.changes.map((c) => c.product_id).sort()).toEqual(attesi.sort());
  });

  it('una categoria che non esiste, o un criterio vuoto, non scelgono niente', async () => {
    expect((await chiedi({ reply: 'ok', regola: { filtro: { categoria: 'giardino' }, prezzo_percentuale: -10 } })).changes).toHaveLength(0);
    expect((await chiedi({ reply: 'ok', regola: { filtro: {}, prezzo_percentuale: -10 } })).changes).toHaveLength(0);
  });

  it('lo strumento offre il criterio e il prompt lo spiega', async () => {
    createMock.mockResolvedValue(rispostaDelModello({ reply: 'ok' }));
    await POST(makeReq({ instruction: 'x' }));
    const corpo = createMock.mock.calls[0][0] as {
      system: { text: string }[] | string;
      tools: { input_schema: { properties: { regola: { properties: Record<string, unknown> } } } }[];
    };
    expect(corpo.tools[0].input_schema.properties.regola.properties.filtro).toBeTruthy();
    const system = typeof corpo.system === 'string' ? corpo.system : corpo.system.map((b) => b.text).join('\n');
    expect(system).toContain('"filtro"');
  });

  it('le voci singole oltre le 40 il server le taglia', async () => {
    const changes = PRODUCTS.slice(0, 100).map((p) => ({ product_id: p.id, patch: { stock: 3 } }));
    const json = await chiedi({ reply: 'ok', changes });
    expect(json.changes).toHaveLength(40);
  });
});
