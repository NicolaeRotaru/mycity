import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Test route vision extract: comportamento invariato dopo il refactor su runMessage.
 * Auth + supabase + runMessage mockati; rate limit reale (reset per test).
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
import { getServerSupabase } from '@/lib/supabase/server';
import { AiCallError } from '@/lib/ai/run';
import { AiConfigError } from '@/lib/ai/client';

const GOOD_TOOL = {
  name: 'Sedia',
  description: 'Sedia in legno',
  category_slug: 'casa',
  suggested_price_eur: 29.9,
  image_quality: { score: 0.9, issues: [] },
  alt_text: 'Sedia in legno chiaro',
  policy_ok: true,
};

function makeReq(body: unknown): never {
  return new Request('http://localhost/api/vision/extract-product', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as never;
}

describe('POST /api/vision/extract-product', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    runMessageMock.mockResolvedValue({ toolInput: GOOD_TOOL });
  });

  it('400 se manca image_base64', async () => {
    const res = await POST(makeReq({ media_type: 'image/jpeg' }));
    expect(res.status).toBe(400);
  });

  it('400 su media_type non supportato', async () => {
    const res = await POST(makeReq({ image_base64: 'QUJDRA==', media_type: 'image/tiff' }));
    expect(res.status).toBe(400);
  });

  it('400 su base64 non valido', async () => {
    const res = await POST(makeReq({ image_base64: '@@@@', media_type: 'image/jpeg' }));
    expect(res.status).toBe(400);
  });

  it('413 se immagine troppo grande', async () => {
    const res = await POST(makeReq({ image_base64: 'A'.repeat(7_500_001), media_type: 'image/jpeg' }));
    expect(res.status).toBe(413);
  });

  it('200 con shape invariata e category_id risolto dallo slug', async () => {
    const res = await POST(makeReq({ image_base64: 'QUJDRA==', media_type: 'image/jpeg' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      name: 'Sedia',
      description: 'Sedia in legno',
      category_id: 'cat-1',
      subcategory_id: null,
      category_slug: 'casa',
      suggested_price: 29.9,
      attributes: {},
      tags: [],
      image_quality: { score: 0.9, issues: [] },
      alt_text: 'Sedia in legno chiaro',
    });
  });

  it('blocca con 400 i prodotti vietati (policy_ok=false)', async () => {
    runMessageMock.mockResolvedValue({ toolInput: { ...GOOD_TOOL, policy_ok: false, policy_reason: 'arma da fuoco' } });
    const res = await POST(makeReq({ image_base64: 'QUJDRA==', media_type: 'image/jpeg' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.message).toMatch(/non può essere pubblicato/i);
  });

  it('le foto di bassa qualità NON bloccano (200 + image_quality/alt_text nel payload)', async () => {
    runMessageMock.mockResolvedValue({ toolInput: { ...GOOD_TOOL, image_quality: { score: 0.2, issues: ['sfocata'] } } });
    const res = await POST(makeReq({ image_base64: 'QUJDRA==', media_type: 'image/jpeg' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.image_quality.score).toBe(0.2);
    expect(json.alt_text).toBe('Sedia in legno chiaro');
  });

  it('normalizza gli attributi estratti (scarta stringhe vuote/whitespace)', async () => {
    runMessageMock.mockResolvedValue({
      toolInput: { ...GOOD_TOOL, attributes: { colore: 'Nero', materiale: '  ', marca: 'Ikea' } },
    });
    const res = await POST(makeReq({ image_base64: 'QUJDRA==', media_type: 'image/jpeg' }));
    const json = await res.json();
    expect(json.attributes).toEqual({ colore: 'Nero', marca: 'Ikea' });
  });

  it('accetta images[] (2 foto) e invia N blocchi image + 1 testo', async () => {
    const res = await POST(makeReq({
      images: [
        { image_base64: 'QUJD', media_type: 'image/jpeg' },
        { image_base64: 'RUZH', media_type: 'image/png' },
      ],
    }));
    expect(res.status).toBe(200);
    const content = runMessageMock.mock.calls[0][0].messages[0].content;
    expect(content.filter((b: { type: string }) => b.type === 'image')).toHaveLength(2);
    expect(content.filter((b: { type: string }) => b.type === 'text')).toHaveLength(1);
  });

  it('400 se più di 4 foto', async () => {
    const imgs = Array.from({ length: 5 }, () => ({ image_base64: 'QUJD', media_type: 'image/jpeg' }));
    const res = await POST(makeReq({ images: imgs }));
    expect(res.status).toBe(400);
  });

  it('413 se una delle foto in images[] è troppo grande', async () => {
    const res = await POST(makeReq({
      images: [
        { image_base64: 'QUJD', media_type: 'image/jpeg' },
        { image_base64: 'A'.repeat(7_500_001), media_type: 'image/jpeg' },
      ],
    }));
    expect(res.status).toBe(413);
  });

  it('502 se manca il blocco tool_use', async () => {
    runMessageMock.mockResolvedValue({ toolInput: undefined });
    const res = await POST(makeReq({ image_base64: 'QUJDRA==', media_type: 'image/jpeg' }));
    expect(res.status).toBe(502);
  });

  it('503 su 401 upstream, 429 su 429, 502 altrimenti', async () => {
    runMessageMock.mockRejectedValue(new AiCallError('vision-extract', 401));
    expect((await POST(makeReq({ image_base64: 'QUJDRA==', media_type: 'image/jpeg' }))).status).toBe(503);
    __resetRateLimitBuckets();
    runMessageMock.mockRejectedValue(new AiCallError('vision-extract', 429));
    expect((await POST(makeReq({ image_base64: 'QUJDRA==', media_type: 'image/jpeg' }))).status).toBe(429);
    __resetRateLimitBuckets();
    runMessageMock.mockRejectedValue(new AiCallError('vision-extract', 500));
    expect((await POST(makeReq({ image_base64: 'QUJDRA==', media_type: 'image/jpeg' }))).status).toBe(502);
  });

  it('503 se config AI assente a runtime (AiConfigError)', async () => {
    runMessageMock.mockRejectedValue(new AiConfigError());
    const res = await POST(makeReq({ image_base64: 'QUJDRA==', media_type: 'image/jpeg' }));
    expect(res.status).toBe(503);
  });

  it('200 con category_id null se il lookup categoria fallisce', async () => {
    vi.mocked(getServerSupabase).mockImplementationOnce(() => { throw new Error('db down'); });
    const res = await POST(makeReq({ image_base64: 'QUJDRA==', media_type: 'image/jpeg' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.category_id).toBeNull();
  });

  it('429 dopo 10 chiamate / 5 min', async () => {
    for (let i = 0; i < 10; i++) {
      const ok = await POST(makeReq({ image_base64: 'QUJDRA==', media_type: 'image/jpeg' }));
      expect(ok.status).toBe(200);
    }
    const res = await POST(makeReq({ image_base64: 'QUJDRA==', media_type: 'image/jpeg' }));
    expect(res.status).toBe(429);
  });
});
