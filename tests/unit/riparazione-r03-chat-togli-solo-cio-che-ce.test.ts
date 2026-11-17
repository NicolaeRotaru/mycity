/**
 * R03-015 — Nella chat Assistenza la scheda della proposta prometteva
 * caratteristiche che il server butta via. Restava la rimozione: «Rimuovi
 * marca» su una focaccia che la marca non ce l'ha. La scheda la mostrava
 * (il campo esiste fra quelli degli alimentari), il server non toglieva
 * niente, e con un'altra modifica insieme la chat diceva «Modifiche salvate».
 * Adesso la proposta tiene una rimozione solo se il prodotto ha quel dato,
 * come fa il server.
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
  images: [], attributes: { allergeni: 'glutine' } as Record<string, unknown>, tags: ['forno'], has_variants: false,
};
const CATEGORIE = [
  { id: 'alim', name: 'Alimentari', slug: 'alimentari', parent_id: null },
  { id: 'pane', name: 'Pane e forno', slug: 'pane-e-forno', parent_id: 'alim' },
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
  runMessageMock.mockResolvedValue({ text: '', toolInput: { reply: 'Fatto', product_id: FOCACCIA.id, patch } });
  const res = await POST(
    new Request('http://localhost/api/ai/catalog-chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ focusProductId: FOCACCIA.id, history: [{ role: 'user', content: 'togli la marca e cambia il nome' }] }),
    }) as never,
  );
  return ((await res.json()) as { patch: Record<string, unknown> }).patch;
}

function sulServer(patch: Record<string, unknown>) {
  return resolveAiPatch({
    patch: patch as never,
    current: { attributes: FOCACCIA.attributes, category_id: FOCACCIA.category_id, has_variants: false, price: FOCACCIA.price },
    categories: CATEGORIE,
  });
}

describe('la chat promette di togliere solo cio\' che il prodotto ha', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    FOCACCIA.attributes = { allergeni: 'glutine' };
  });

  it('«togli la marca» su una focaccia senza marca: la proposta non la promette, e il server non la toglierebbe', async () => {
    const p = await proposta({ name: 'Focaccia ligure', attributes_remove: ['marca'] });
    expect(p).not.toHaveProperty('attributes_remove');
    expect(p.name).toBe('Focaccia ligure');
    // Quello che resta nella proposta e' esattamente quello che il server cambia.
    expect(sulServer({ attributes_remove: ['marca'] }).changed).toEqual([]);
  });

  it('una marca che c\'e\': la proposta la toglie, come il server', async () => {
    FOCACCIA.attributes = { allergeni: 'glutine', marca: 'Forno Rossi' };
    const p = await proposta({ attributes_remove: ['marca'] });
    expect(p.attributes_remove).toEqual(['marca']);
    expect(sulServer(p).changed).toEqual(['rimosso marca']);
  });

  it('scritta e tolta nella stessa proposta: si tiene, come fa il server dopo averla scritta', async () => {
    const p = await proposta({ attributes: { marca: 'Forno Rossi' }, attributes_remove: ['Marca'] });
    expect(p.attributes_remove).toEqual(['Marca']);
    expect(sulServer(p).changed).toContain('rimosso marca');
  });

  it('le dichiarazioni da togliere restano: la scheda dice che le decide il venditore', async () => {
    const p = await proposta({ attributes_remove: ['allergeni'] });
    expect(p.attributes_remove).toEqual(['allergeni']);
  });
});
