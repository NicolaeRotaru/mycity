import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * R03-005 — Il Copilot non riusciva a preparare una modifica su tutto il catalogo oltre circa cento
 * prodotti. Anche con la «regola» (gli id e l'operazione) ogni id costa 20-25 token: 150 id stanno
 * oltre il tetto di 3000 token della risposta, il modello si fermava a metà e il negoziante leggeva
 * «Riprova» a ogni tentativo. Adesso, per un'operazione su TUTTI i prodotti, il modello scrive
 * «tutti»: true e gli id li mette il server.
 */

const FAKE_USER = { id: 'seller-1', email: 's@x.com' };
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth: (h: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) => (req: Request) => h({ user: FAKE_USER, req }),
}));

const PRODUCTS = Array.from({ length: 150 }, (_, i) => ({
  id: `aaaaaaaa-0000-0000-0000-${String(i).padStart(12, '0')}`,
  name: `Prodotto ${i}`, description: '', price: 20, compare_at_price: null, unit: 'pezzo', condition: null,
  stock: 1, status: 'available', category_id: 'el', images: [], attributes: {}, tags: [], has_variants: false,
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (table: string) =>
      table === 'products'
        ? { select: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: PRODUCTS, error: null }) }) }) }) }
        : { select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) },
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

describe('R03-005 · una modifica su tutto il catalogo, oltre cento prodotti', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  });

  it('«abbassa del 10% tutto» su 150 prodotti: il modello dice «tutti», il server prepara 150 modifiche', async () => {
    createMock.mockResolvedValue(
      rispostaDelModello({ reply: 'Ho preparato il ribasso del 10% su tutto.', regola: { tutti: true, prezzo_percentuale: -10 } }),
    );
    const res = await POST(makeReq({ instruction: 'abbassa del 10% tutto' }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { changes: { product_id: string; patch: { price?: number } }[] };
    expect(json.changes).toHaveLength(150);
    expect(new Set(json.changes.map((c) => c.product_id)).size).toBe(150);
    expect(json.changes.every((c) => c.patch.price === 18)).toBe(true);
  });

  it('lo strumento offre «tutti» e non obbliga a scrivere gli id; il prompt lo spiega e mette un tetto alle voci singole', async () => {
    createMock.mockResolvedValue(rispostaDelModello({ reply: 'ok', changes: [] }));
    await POST(makeReq({ instruction: 'abbassa del 10% tutto' }));
    const corpo = createMock.mock.calls[0][0] as {
      system: { text: string }[] | string;
      tools: { input_schema: { properties: { regola: { properties: Record<string, unknown>; required?: string[] } } } }[];
    };
    const regola = corpo.tools[0].input_schema.properties.regola;
    expect(regola.properties.tutti).toBeTruthy();
    expect(regola.required ?? []).not.toContain('product_ids');
    const system = typeof corpo.system === 'string' ? corpo.system : corpo.system.map((b) => b.text).join('\n');
    expect(system).toContain('"tutti": true');
    expect(system).toMatch(/al massimo 40 voci/);
  });

  it('senza «tutti» la regola resta sugli id che il modello ha scritto', async () => {
    createMock.mockResolvedValue(
      rispostaDelModello({ reply: 'ok', regola: { product_ids: [PRODUCTS[0].id, PRODUCTS[1].id], prezzo_percentuale: -10 } }),
    );
    const res = await POST(makeReq({ instruction: 'abbassa del 10% i primi due' }));
    const json = (await res.json()) as { changes: { product_id: string }[] };
    expect(json.changes.map((c) => c.product_id)).toEqual([PRODUCTS[0].id, PRODUCTS[1].id]);
  });
});
