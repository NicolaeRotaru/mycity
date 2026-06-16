import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Route estrazione multi-prodotto: auth mockata; runMessage mockato; admin
 * Supabase mockato (categorie). Verifica raggruppamento → normalizzazione:
 * indici foto validati, prodotti senza foto scartati, categoria risolta, gate
 * policy passato attraverso.
 */

const FAKE_USER = { id: 'seller-1', email: 's@x.com' };

vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth: (handler: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) =>
    (req: Request) => handler({ user: FAKE_USER, req }),
}));

const CATEGORIES = [{ id: 'casa-top', name: 'Casa', slug: 'casa', parent_id: null }];
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: () => ({ select: () => ({ order: () => Promise.resolve({ data: CATEGORIES, error: null }) }) }),
  }),
}));

const runMessageMock = vi.fn();
vi.mock('@/lib/ai/run', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/run')>();
  return { ...actual, runMessage: (...a: unknown[]) => runMessageMock(...a) };
});

import { POST } from '@/app/api/vision/extract-products/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';
import { AiCallError } from '@/lib/ai/run';

const IMG = { image_base64: 'aGVsbG8gd29ybGQ=', media_type: 'image/jpeg' as const };

function makeReq(body: unknown): never {
  return new Request('http://localhost/api/vision/extract-products', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as never;
}

function products() {
  return {
    toolInput: {
      products: [
        { image_indexes: [0, 1], name: 'Lampada', category_slug: 'casa', suggested_price_eur: 9.99, tags: ['lampada'], policy_ok: true },
        { image_indexes: [99], name: 'Fantasma', category_slug: 'casa', suggested_price_eur: 5, policy_ok: true }, // indici invalidi → scartato
        { image_indexes: [2], name: 'Coltello', category_slug: 'casa', suggested_price_eur: 3, policy_ok: false, policy_reason: 'arma' },
      ],
    },
  };
}

describe('POST /api/vision/extract-products', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    runMessageMock.mockResolvedValue(products());
  });

  it('503 se la chiave AI non è configurata', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const res = await POST(makeReq({ images: [IMG, IMG, IMG] }));
    expect(res.status).toBe(503);
  });

  it('400 se meno di 2 foto', async () => {
    const res = await POST(makeReq({ images: [IMG] }));
    expect(res.status).toBe(400);
  });

  it('200: scarta i prodotti senza foto valide, risolve categoria, passa la policy', async () => {
    const res = await POST(makeReq({ images: [IMG, IMG, IMG] }));
    expect(res.status).toBe(200);
    const json = await res.json();
    // "Fantasma" (indici [99]) scartato → restano Lampada + Coltello.
    expect(json.products).toHaveLength(2);
    const lampada = json.products[0];
    expect(lampada.name).toBe('Lampada');
    expect(lampada.image_indexes).toEqual([0, 1]);
    expect(lampada.category_id).toBe('casa-top');
    expect(lampada.category_name).toBe('Casa');
    expect(lampada.suggested_price).toBe(9.99);
    const coltello = json.products[1];
    expect(coltello.policy_ok).toBe(false);
    expect(coltello.policy_reason).toBe('arma');
  });

  it('chiama runMessage con il modello vision e il tool extract_products', async () => {
    await POST(makeReq({ images: [IMG, IMG] }));
    const arg = runMessageMock.mock.calls[0][0];
    expect(arg.tools.some((t: { name?: string }) => t.name === 'extract_products')).toBe(true);
    expect(arg.tool_choice).toMatchObject({ type: 'tool', name: 'extract_products' });
  });

  it('429 quando runMessage segnala rate limit upstream', async () => {
    runMessageMock.mockRejectedValue(new AiCallError('vision-extract-multi', 429));
    const res = await POST(makeReq({ images: [IMG, IMG] }));
    expect(res.status).toBe(429);
  });

  it('429 dopo 6 chiamate / 10 min', async () => {
    for (let i = 0; i < 6; i++) {
      const ok = await POST(makeReq({ images: [IMG, IMG] }));
      expect(ok.status).toBe(200);
    }
    const res = await POST(makeReq({ images: [IMG, IMG] }));
    expect(res.status).toBe(429);
  });
});
