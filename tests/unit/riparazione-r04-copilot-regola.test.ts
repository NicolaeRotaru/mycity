import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * R04-007 — Il copilot non riusciva a preparare una modifica su tutto il
 * catalogo oltre circa cento prodotti: una voce per prodotto non entrava nel
 * tetto della risposta. Adesso il modello puo' mandare una regola (id +
 * operazione) e il server calcola i valori, per tutti i 150 prodotti.
 */

const FAKE_USER = { id: 'seller-1', email: 's@x.com' };
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth: (h: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) => (req: Request) => h({ user: FAKE_USER, req }),
}));
const PRODUCTS = Array.from({ length: 150 }, (_, i) => ({
  id: `aaaaaaaa-0000-0000-0000-${String(i).padStart(12, '0')}`,
  name: `Prodotto ${i}`, description: '', price: i % 2 === 0 ? 20 : '10.00', compare_at_price: null, unit: 'pezzo',
  condition: null, stock: 5, status: 'available', category_id: 'el', images: [], attributes: {},
  tags: ['estate', 'saldi'], has_variants: false,
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (table: string) =>
      table === 'products'
        ? { select: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: PRODUCTS, error: null }) }) }) }) }
        : { select: () => ({ order: () => Promise.resolve({ data: [{ id: 'el', name: 'Elettronica', slug: 'elettronica', parent_id: null }], error: null }) }) },
  }),
}));
vi.mock('@/lib/ai/moderation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/moderation')>();
  return { ...actual, assertSafeText: async () => undefined };
});
const runMessageMock = vi.fn();
vi.mock('@/lib/ai/run', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/run')>();
  return { ...actual, runMessage: (...a: unknown[]) => runMessageMock(...a) };
});

import { POST } from '@/app/api/ai/copilot/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

const chiedi = (instruction: string) =>
  POST(new Request('http://localhost/api/ai/copilot', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ instruction }),
  }) as never);

type Risposta = { changes: { product_id: string; patch: { price?: number; tags?: string[]; status?: string } }[] };

describe('una modifica su tutto il catalogo, anche oltre cento prodotti', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  });

  it('«abbassa del 10% tutto» su 150 prodotti: 150 modifiche, prezzo calcolato dal server', async () => {
    runMessageMock.mockResolvedValue({
      toolInput: { reply: 'Ho preparato 150 modifiche', regola: { product_ids: PRODUCTS.map((p) => p.id), prezzo_percentuale: -10 } },
    });
    const corpo = (await (await chiedi('abbassa del 10% tutto')).json()) as Risposta;
    expect(corpo.changes).toHaveLength(150);
    expect(corpo.changes[0].patch.price).toBe(18);
    expect(corpo.changes[1].patch.price).toBe(9);
  });

  it('«aggiungi il tag natale a tutto»: i tag partono da quelli veri del prodotto', async () => {
    runMessageMock.mockResolvedValue({
      toolInput: { reply: 'ok', regola: { product_ids: PRODUCTS.map((p) => p.id), aggiungi_tag: ['natale'], togli_tag: ['estate'] } },
    });
    const corpo = (await (await chiedi('aggiungi natale e togli estate')).json()) as Risposta;
    expect(corpo.changes).toHaveLength(150);
    expect(corpo.changes[0].patch.tags).toEqual(['saldi', 'natale']);
  });

  it('un id che non e\' del venditore non entra', async () => {
    runMessageMock.mockResolvedValue({
      toolInput: { reply: 'ok', regola: { product_ids: ['bbbbbbbb-0000-0000-0000-000000000000', PRODUCTS[0].id], status: 'draft' } },
    });
    const corpo = (await (await chiedi('metti in bozza')).json()) as Risposta;
    expect(corpo.changes.map((c) => c.product_id)).toEqual([PRODUCTS[0].id]);
  });

  it('una percentuale oltre la banda del 30% non diventa una proposta di prezzo', async () => {
    runMessageMock.mockResolvedValue({ toolInput: { reply: 'ok', regola: { product_ids: [PRODUCTS[0].id], prezzo_percentuale: 1e6 } } });
    const corpo = (await (await chiedi('alza tutto')).json()) as Risposta;
    expect(corpo.changes).toEqual([]);
  });

  it('un prodotto che passerebbe i 15 tag non riceve la proposta dei tag', async () => {
    const pieno = { ...PRODUCTS[0], tags: Array.from({ length: 15 }, (_, i) => `t${i}`) };
    PRODUCTS[0] = pieno;
    runMessageMock.mockResolvedValue({ toolInput: { reply: 'ok', regola: { product_ids: [pieno.id], aggiungi_tag: ['natale'] } } });
    const corpo = (await (await chiedi('aggiungi natale')).json()) as Risposta;
    expect(corpo.changes).toEqual([]);
  });

  it('il modello sa che puo\' usare la regola', async () => {
    runMessageMock.mockResolvedValue({ toolInput: { reply: 'ok' } });
    await chiedi('abbassa tutto');
    const args = runMessageMock.mock.calls[0][0] as { system: unknown; tools: { input_schema: { properties: Record<string, unknown> } }[] };
    expect(args.tools[0].input_schema.properties).toHaveProperty('regola');
    expect(JSON.stringify(args.system)).toMatch(/regola/);
  });
});
