import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * S10 (5/11/2026) — la lettura di un prodotto dalla foto: messaggio con l'AI
 * spenta, tetto della risposta, categoria Giocattoli, dichiarazioni dal web.
 */

const FAKE_USER = { id: 'seller-1', email: 's@x.com' };

vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth: (handler: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) =>
    (req: Request) => handler({ user: FAKE_USER, req }),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: vi.fn(() => ({
    from: () => ({
      select: () => ({ eq: () => ({ is: () => ({ single: () => Promise.resolve({ data: { id: 'cat-1' }, error: null }) }) }) }),
    }),
  })),
}));

const runMessageMock = vi.fn();
vi.mock('@/lib/ai/run', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/run')>();
  return { ...actual, runMessage: (...a: unknown[]) => runMessageMock(...a) };
});

import { POST } from '@/app/api/vision/extract-product/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';
import { AiConfigError } from '@/lib/ai/client';

const JPEG_VERO = '/9j/4AAQSkZJRgABAQAAAQABAAA=';
const GOOD_TOOL = {
  name: 'Biscotti al burro',
  description: 'Biscotti',
  category_slug: 'alimentari',
  suggested_price_eur: 3.5,
  image_quality: { score: 0.9, issues: [] },
  alt_text: 'Confezione di biscotti',
  policy_ok: true,
};

function makeReq(body: unknown): never {
  return new Request('http://localhost/api/vision/extract-product', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimitBuckets();
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
});

describe('lettura dalla foto (S10)', () => {
  it('con l\'AI spenta dice che è spenta, non «chiave non valida» (249)', async () => {
    runMessageMock.mockRejectedValue(new AiConfigError('Gli strumenti AI per i negozi non sono ancora attivi.'));
    const res = await POST(makeReq({ image_base64: JPEG_VERO, media_type: 'image/jpeg' }));
    expect(res.status).toBe(503);
    const testo = JSON.stringify(await res.json());
    expect(testo).toContain('non sono ancora attivi');
    expect(testo).not.toMatch(/non valida/);
  });

  it('concede abbastanza token per un\'etichetta alimentare completa (244)', async () => {
    runMessageMock.mockResolvedValue({ toolInput: { ...GOOD_TOOL, confidence: 0.9 } });
    await POST(makeReq({ image_base64: JPEG_VERO, media_type: 'image/jpeg' }));
    expect(runMessageMock.mock.calls[0][0].max_tokens).toBeGreaterThanOrEqual(1500);
  });

  it('conosce la categoria Giocattoli (614)', async () => {
    runMessageMock.mockResolvedValue({ toolInput: { ...GOOD_TOOL, confidence: 0.9 } });
    await POST(makeReq({ image_base64: JPEG_VERO, media_type: 'image/jpeg' }));
    const tool = runMessageMock.mock.calls[0][0].tools[0];
    expect(tool.input_schema.properties.category_slug.enum).toContain('giocattoli');
    expect(tool.input_schema.properties.category_slug.description).toContain('giocattoli');
  });

  it('dopo la ricerca sul web allergeni e ingredienti restano quelli letti in etichetta (1633)', async () => {
    runMessageMock
      .mockResolvedValueOnce({
        toolInput: { ...GOOD_TOOL, confidence: 0.3, attributes: { allergeni: 'Glutine', peso: '200 g' } },
      })
      .mockResolvedValueOnce({
        toolInput: {
          ...GOOD_TOOL,
          confidence: 0.9,
          attributes: { allergeni: 'Glutine, latte, uova (dal web)', ingredienti: 'farina dal web', peso: '250 g' },
        },
      });
    const res = await POST(makeReq({ image_base64: JPEG_VERO, media_type: 'image/jpeg' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    const attributi = JSON.stringify(json);
    expect(attributi).not.toContain('dal web');
    expect(attributi).toContain('250 g');
  });
});

describe('lettura multipla e import: le liste di categorie (614)', () => {
  it('visionShared e externalSync conoscono giocattoli', async () => {
    const { CATEGORY_SLUGS } = await import('@/lib/products/visionShared');
    expect(CATEGORY_SLUGS).toContain('giocattoli');
    const { readFileSync } = await import('node:fs');
    expect(readFileSync('lib/products/externalSync.ts', 'utf8')).toMatch(/'sport', 'giocattoli'/);
  });
});
