import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * R03-008 — La lettura da foto bloccava un prodotto vietato solo con policy_ok === false (il
 * booleano): se il modello scriveva «"false"» come testo, il prodotto passava. Adesso passa solo
 * un sì scritto bene, come nel filtro di lib/ai/moderation.ts.
 */

const FAKE_USER = { id: 'seller-1', email: 's@x.com' };
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth: (handler: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) =>
    (req: Request) => handler({ user: FAKE_USER, req }),
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), spesa: vi.fn(), debug: vi.fn() },
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

const JPEG_VERO = '/9j/4AAQSkZJRgABAQAAAQABAAA=';
const LETTURA = {
  name: 'Coltello a serramanico', description: 'Lama 12 cm', category_slug: 'casa', suggested_price_eur: 25,
  image_quality: { score: 0.9, issues: [] }, alt_text: 'Coltello', confidence: 0.95,
};

function makeReq(body: unknown): never {
  return new Request('http://localhost/api/vision/extract-product', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }) as never;
}

describe('R03-008 · il «false» scritto come testo non è un prodotto ammesso', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  });

  it('policy_ok «"false"» col motivo: 400, il prodotto non passa', async () => {
    runMessageMock.mockResolvedValue({ toolInput: { ...LETTURA, policy_ok: 'false', policy_reason: 'arma bianca' } });
    const res = await POST(makeReq({ image_base64: JPEG_VERO, media_type: 'image/jpeg' }));
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('non può essere pubblicato su MyCity: arma bianca');
  });

  it('policy_ok mancante: nel dubbio non passa', async () => {
    runMessageMock.mockResolvedValue({ toolInput: { ...LETTURA } });
    const res = await POST(makeReq({ image_base64: JPEG_VERO, media_type: 'image/jpeg' }));
    expect(res.status).toBe(400);
  });

  it('con «"false"» e poca sicurezza non parte neanche la verifica sul web', async () => {
    runMessageMock.mockResolvedValue({ toolInput: { ...LETTURA, confidence: 0.3, policy_ok: 'false' } });
    const res = await POST(makeReq({ image_base64: JPEG_VERO, media_type: 'image/jpeg' }));
    expect(res.status).toBe(400);
    expect(runMessageMock).toHaveBeenCalledTimes(1);
  });

  it('controprova: policy_ok true passa', async () => {
    runMessageMock.mockResolvedValue({ toolInput: { ...LETTURA, name: 'Sedia', policy_ok: true } });
    const res = await POST(makeReq({ image_base64: JPEG_VERO, media_type: 'image/jpeg' }));
    expect(res.status).toBe(200);
  });
});
