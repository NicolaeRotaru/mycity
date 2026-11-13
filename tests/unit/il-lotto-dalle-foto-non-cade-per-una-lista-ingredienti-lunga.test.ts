import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * 1/11/2026 — Il fornaio spunta «le ho controllate» su dodici bozze lette dalle
 * foto. Una sola ha una lista ingredienti di 900 caratteri: prima lo schema
 * (tetto 500 su OGNI attributo) rifiutava la richiesta intera con «Dati prodotti
 * non validi.», e nessuna bozza nasceva. Le scelte di Nicola:
 *  - ingredienti e valori nutrizionali fino a 2000 caratteri, interi, non tagliati;
 *  - un campo oltre il tetto scarta SOLO quel prodotto, col suo nome e il nome
 *    del campo; gli altri nascono.
 */

const FAKE_USER = { id: 'seller-1', email: 's@x.com' };

// 12/11/2026 (R04-006) — La rotta ora legge l'interruttore spento al lancio:
// qui si prova la funzione accesa, come prima.
vi.mock('@/lib/funzioni-al-lancio', async (originale) => ({
  ...((await originale()) as Record<string, unknown>),
  AI_NEGOZI_ACCESA: true,
}));
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth: (handler: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) =>
    (req: Request) => handler({ user: FAKE_USER, req }),
}));

const CATEGORIES = [{ id: 'alim-top', name: 'Alimentari', slug: 'alimentari', parent_id: null }];

const insertSelectMock = vi.fn();
const insertMock = vi.fn();
const fromMock = vi.fn((table: string) => {
  if (table === 'categories') {
    return { select: () => ({ order: () => Promise.resolve({ data: CATEGORIES, error: null }) }) };
  }
  return { insert: insertMock };
});

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({ from: fromMock }),
}));

vi.mock('@/lib/ai/moderation', () => ({
  classifyProductPolicy: async () => ({ allowed: true }),
}));

import { POST } from '@/app/api/ai/catalog-create-bulk/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

function makeReq(body: unknown): never {
  return new Request('http://localhost/api/ai/catalog-create-bulk', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never;
}

const FOTO = ['https://abcdefgh.supabase.co/storage/v1/object/public/products/a.jpg'];

function item(name: string, attributes: Record<string, string>) {
  return {
    imageUrls: FOTO,
    draft: {
      name,
      category_slug: 'alimentari',
      suggested_price: 4.5,
      attributes,
      dichiarazioni_confermate: true,
    },
  };
}

const INGREDIENTI_LUNGHI = 'farina di grano tenero tipo 0, '.repeat(30).trim(); // ~900 caratteri

describe('catalog-create-bulk: una lista ingredienti lunga non fa cadere il lotto', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    insertMock.mockReturnValue({ select: insertSelectMock });
    insertSelectMock.mockResolvedValue({ data: [], error: null });
  });

  it('ingredienti di ~900 caratteri: la bozza nasce con la lista intera, non tagliata', async () => {
    expect(INGREDIENTI_LUNGHI.length).toBeGreaterThan(500);
    expect(INGREDIENTI_LUNGHI.length).toBeLessThanOrEqual(2000);
    const res = await POST(
      makeReq({
        items: [
          item('Focaccia', { ingredienti: INGREDIENTI_LUNGHI, allergeni: 'Glutine' }),
          item('Pane', { ingredienti: 'farina, acqua, sale', allergeni: 'Glutine' }),
        ],
      }),
    );
    expect(res.status).toBe(200);
    const payloads = insertMock.mock.calls[0][0] as Array<{ name: string; attributes: Record<string, string> }>;
    expect(payloads).toHaveLength(2);
    const focaccia = payloads.find((p) => p.name === 'Focaccia')!;
    expect(focaccia.attributes.ingredienti).toBe(INGREDIENTI_LUNGHI);
  });

  it('un campo oltre il tetto scarta solo quel prodotto, col nome del prodotto e del campo', async () => {
    const res = await POST(
      makeReq({
        items: [
          item('Focaccia', { ingredienti: 'x'.repeat(2001), allergeni: 'Glutine' }),
          item('Olive', { origine: 'y'.repeat(501), allergeni: 'Nessuno' }),
          item('Pane', { ingredienti: 'farina, acqua, sale', allergeni: 'Glutine' }),
        ],
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    const payloads = insertMock.mock.calls[0][0] as Array<{ name: string }>;
    expect(payloads.map((p) => p.name)).toEqual(['Pane']);
    const scartati = json.scartati as Array<{ nome: string; motivo: string }>;
    expect(scartati).toHaveLength(2);
    expect(scartati.find((s) => s.nome === 'Focaccia')?.motivo).toContain('ingredienti');
    expect(scartati.find((s) => s.nome === 'Olive')?.motivo).toContain('origine');
  });

  it('un campo enorme (oltre 8000 caratteri) scarta solo quel prodotto, non tutto il lotto', async () => {
    const res = await POST(
      makeReq({
        items: [
          item('Focaccia', { ingredienti: 'x'.repeat(9000), allergeni: 'Glutine' }),
          item('Pane', { ingredienti: 'farina, acqua, sale', allergeni: 'Glutine' }),
        ],
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    const payloads = insertMock.mock.calls[0][0] as Array<{ name: string }>;
    expect(payloads.map((p) => p.name)).toEqual(['Pane']);
    expect((json.scartati as Array<{ nome: string; motivo: string }>)[0]).toMatchObject({ nome: 'Focaccia' });
  });
});
