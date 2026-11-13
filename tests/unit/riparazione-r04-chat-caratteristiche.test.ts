/**
 * R04-019 — Nella chat Assistenza la scheda della proposta prometteva
 * caratteristiche che il server butta via (un campo che la categoria non ha,
 * una scelta non ammessa), e dopo «Applica» diceva «Modifiche salvate» senza
 * aver cambiato niente. Adesso la proposta che esce dalla rotta tiene solo le
 * caratteristiche che il server applicherebbe.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';


const FAKE_USER = { id: 'forno-1', email: 'forno@x.it' };
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth:
    (h: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) => (req: Request) =>
      h({ user: FAKE_USER, req }),
}));

const FOCACCIA = {
  id: 'aaaaaaaa-0000-0000-0000-000000000001',
  name: 'Focaccia', description: 'Focaccia genovese', price: 3.5, compare_at_price: null,
  unit: 'pezzo', condition: null, stock: 5, status: 'available', category_id: 'alim',
  images: [], attributes: { allergeni: 'glutine' }, tags: ['forno'], has_variants: false,
};
const CATEGORIE = [
  { id: 'alim', name: 'Alimentari', slug: 'alimentari', parent_id: null },
  { id: 'pane', name: 'Pane e forno', slug: 'pane-e-forno', parent_id: 'alim' },
  { id: 'casa', name: 'Casa', slug: 'casa', parent_id: null },
  // Una categoria di primo livello che non ha caratteristiche sue.
  { id: 'gioc', name: 'Giocattoli', slug: 'giocattoli', parent_id: null },
];

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (table: string) =>
      table === 'products'
        ? { select: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [FOCACCIA], error: null }) }) }) }) }
        : { select: () => ({ order: () => Promise.resolve({ data: CATEGORIE, error: null }) }) },
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
import { resolveAiPatch } from '@/lib/products/aiPatch';

async function proposta(patch: unknown): Promise<Record<string, unknown>> {
  runMessageMock.mockResolvedValue({ text: '', toolInput: { reply: 'Ecco', product_id: FOCACCIA.id, patch } });
  const res = await POST(
    new Request('http://localhost/api/ai/catalog-chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ focusProductId: FOCACCIA.id, history: [{ role: 'user', content: 'metti colore dorato e confezione sacchetto' }] }),
    }) as never,
  );
  return ((await res.json()) as { patch: Record<string, unknown> }).patch;
}

describe('la chat non promette caratteristiche che il server butta', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  });

  it('colore su un alimento e confezione non ammessa: non escono nella proposta', async () => {
    const p = await proposta({ attributes: { colore: 'dorato', confezione: 'Sacchetto di carta' } });
    expect(p).not.toHaveProperty('attributes');
  });

  it('una confezione ammessa e l\'origine restano: il server le applica', async () => {
    const p = await proposta({ attributes: { colore: 'dorato', confezione: 'Busta', origine: 'Liguria' } });
    expect(p.attributes).toEqual({ confezione: 'Busta', origine: 'Liguria' });
    const { changed } = resolveAiPatch({ patch: p as never, current: { ...FOCACCIA, attributes: {} } as never, categories: CATEGORIE });
    expect(changed.length).toBeGreaterThan(0);
  });

  it('togliere un campo che la scheda non ha, o voci senza senso: non si promette', async () => {
    const p = await proposta({ attributes_remove: ['colore', null, 5, {}] });
    expect(p).not.toHaveProperty('attributes_remove');
  });

  it('togliere un attributo rimasto da una categoria di prima, che c\'e\' davvero: si propone come fa il server', async () => {
    FOCACCIA.attributes = { ...FOCACCIA.attributes, colore: 'rosso' } as typeof FOCACCIA.attributes;
    const p = await proposta({ attributes_remove: ['colore'] });
    expect(p.attributes_remove).toEqual(['colore']);
    FOCACCIA.attributes = { allergeni: 'glutine' };
  });

  it('un valore di soli spazi non si promette (il server lo scarta)', async () => {
    const p = await proposta({ attributes: { marca: '   ' } });
    expect(p).not.toHaveProperty('attributes');
  });

  it('le dichiarazioni restano nella proposta: la scheda dice che le scrive il venditore', async () => {
    const p = await proposta({ attributes: { allergeni: 'latte' } });
    expect(p.attributes).toEqual({ allergeni: 'latte' });
  });
});
