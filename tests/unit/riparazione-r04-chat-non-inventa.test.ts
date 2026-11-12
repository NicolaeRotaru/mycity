import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * R04-001 (parte nel mio territorio) — Il prompt della chat Assistenza deve
 * dire al modello di non inventare ingredienti, allergeni, origine o diciture
 * «senza…» nella descrizione. Gira la rotta vera con un modello finto.
 */

const FAKE_USER = { id: 'forno-1', email: 'forno@x.it' };
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth:
    (h: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) => (req: Request) =>
      h({ user: FAKE_USER, req }),
}));
const PANETTONE = {
  id: 'aaaaaaaa-0000-0000-0000-000000000002',
  name: 'Panettone', description: 'Lievitazione 36 ore', price: 28, compare_at_price: null,
  unit: 'pezzo', condition: null, stock: 5, status: 'available', category_id: 'alim',
  images: [], attributes: {}, tags: ['dolci', 'natale'], has_variants: false,
};
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (table: string) =>
      table === 'products'
        ? { select: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [PANETTONE], error: null }) }) }) }) }
        : { select: () => ({ order: () => Promise.resolve({ data: [{ id: 'alim', name: 'Alimentari', slug: 'alimentari', parent_id: null }], error: null }) }) },
  }),
}));
vi.mock('@/lib/ai/moderation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/moderation')>();
  return { ...actual, assertSafeText: async () => undefined };
});
const runMessageMock = vi.fn();
vi.mock('@/lib/ai/run', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/run')>();
  return { ...actual, runMessage: (...a: unknown[]) => runMessageMock(...(a as [])) };
});

import { POST } from '@/app/api/ai/catalog-chat/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

describe('la chat Assistenza: nel prompt c\'e\' la regola «non inventare»', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  });

  it('il system dice di non aggiungere ingredienti, allergeni, origine o «senza…»', async () => {
    runMessageMock.mockResolvedValue({ text: '', toolInput: { reply: 'Ok', product_id: PANETTONE.id } });
    const res = await POST(
      new Request('http://localhost/api/ai/catalog-chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ focusProductId: PANETTONE.id, history: [{ role: 'user', content: 'scrivi che e senza canditi' }] }),
      }) as never,
    );
    expect(res.status).toBe(200);
    const args = runMessageMock.mock.calls[0][0] as { system: unknown };
    const system = JSON.stringify(args.system);
    expect(system).toMatch(/NON INVENTARE/);
    expect(system).toMatch(/allergeni/);
    expect(system).toMatch(/senza/);
    expect(system).toMatch(/origine/);
    expect(system).toMatch(/PARTENDO da quella attuale/);
  });

  it('in identificazione, se i campi della proposta vengono tolti, la risposta lo dice', async () => {
    runMessageMock.mockResolvedValue({
      text: '',
      toolInput: { reply: 'Ho aggiunto il tag e aggiornato la descrizione: premi Applica.', product_id: PANETTONE.id, patch: { price: 27, tags: ['senza canditi'], description: 'Panettone senza canditi.' } },
    });
    const res = await POST(
      new Request('http://localhost/api/ai/catalog-chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ history: [{ role: 'user', content: 'aggiungi il tag senza canditi al panettone e mettilo a 27' }] }),
      }) as never,
    );
    const corpo = (await res.json()) as { reply: string; patch: Record<string, unknown> };
    expect(corpo.patch).toEqual({ price: 27 });
    expect(corpo.reply).toMatch(/NON li cambio da qui/);
  });
});
