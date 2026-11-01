import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * 1/11/2026 — AL PRIMO MESSAGGIO LA CHAT RISCRIVEVA TAG E DESCRIZIONE SENZA AVERLI VISTI.
 *
 * Senza un prodotto aperto la chat lavora in «identificazione»: al modello
 * arrivano solo id, nome, prezzo, stato e categoria di ogni prodotto. La rotta
 * pero' accettava nello stesso giro anche la proposta di modifica, e un «metti
 * il tag novita'» diventava una lista di tag nuova che cancellava le vecchie.
 * Qui gira la rotta vera, con un modello finto: nessuna chiamata AI vera.
 */

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
  images: [], attributes: { colore: 'dorata' }, tags: ['forno', 'genovese'], has_variants: false,
};
const CATEGORIE = [{ id: 'alim', name: 'Alimentari', slug: 'alimentari', parent_id: null }];

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

async function chiedi(corpo: Record<string, unknown>, patch: unknown) {
  runMessageMock.mockResolvedValue({ text: '', toolInput: { reply: 'Ecco', product_id: FOCACCIA.id, patch } });
  const res = await POST(
    new Request('http://localhost/api/ai/catalog-chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ history: [{ role: 'user', content: 'metti il tag novita alla focaccia' }], ...corpo }),
    }) as never,
  );
  expect(res.status).toBe(200);
  expect(runMessageMock).toHaveBeenCalled();
  return (await res.json()) as { productId: string | null; patch: Record<string, unknown> };
}

describe('in identificazione la chat non propone tag, descrizione o caratteristiche', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  });

  it('primo messaggio, proposta su descrizione e tag: nessuna proposta restituita su quei campi', async () => {
    const json = await chiedi({}, {
      description: 'Una focaccia tutta nuova scritta alla cieca',
      tags: ['novita'],
      attributes: { colore: 'bianca' },
    });
    expect(json.productId).toBe(FOCACCIA.id);
    expect(json.patch).not.toHaveProperty('description');
    expect(json.patch).not.toHaveProperty('tags');
    expect(json.patch).not.toHaveProperty('attributes');
  });

  it('a scheda aperta la stessa proposta passa: il modello quei campi li ha letti', async () => {
    const json = await chiedi({ focusProductId: FOCACCIA.id }, {
      description: 'Una focaccia genovese alta e morbida',
      tags: ['forno', 'genovese', 'novita'],
    });
    expect(json.patch).toHaveProperty('description');
    expect(json.patch).toHaveProperty('tags');
  });
});
