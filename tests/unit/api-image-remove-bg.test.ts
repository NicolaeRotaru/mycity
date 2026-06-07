import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Test route rimozione sfondo: auth + provider mockati via env/fetch.
 * Rate limit reale (reset per test). Default provider 'mock' (dev/CI).
 */

const FAKE_USER = { id: 'seller-1', email: 's@x.com' };

vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth: (handler: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) =>
    (req: Request) => handler({ user: FAKE_USER, req }),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { POST } from '@/app/api/image/remove-bg/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

const SMALL_B64 = 'QUJDRA=='; // "ABCD"

function makeReq(body: unknown): never {
  return new Request('http://localhost/api/image/remove-bg', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as never;
}

describe('POST /api/image/remove-bg', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    // Provider mock di default (dev/CI): ritorna l'immagine invariata.
    vi.stubEnv('BG_REMOVAL_PROVIDER', 'mock');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('400 se manca image_base64', async () => {
    const res = await POST(makeReq({ media_type: 'image/jpeg' }));
    expect(res.status).toBe(400);
  });

  it('400 su media_type non supportato', async () => {
    const res = await POST(makeReq({ image_base64: SMALL_B64, media_type: 'image/tiff' }));
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

  it('200 (mock) ritorna image_base64 + media_type', async () => {
    const res = await POST(makeReq({ image_base64: SMALL_B64, media_type: 'image/jpeg' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ image_base64: SMALL_B64, media_type: 'image/jpeg' });
  });

  it('429 dopo 15 chiamate / 5 min', async () => {
    for (let i = 0; i < 15; i++) {
      const ok = await POST(makeReq({ image_base64: SMALL_B64, media_type: 'image/jpeg' }));
      expect(ok.status).toBe(200);
    }
    const res = await POST(makeReq({ image_base64: SMALL_B64, media_type: 'image/jpeg' }));
    expect(res.status).toBe(429);
  });

  it('503 se il provider reale non è configurato (removebg senza chiave)', async () => {
    vi.stubEnv('BG_REMOVAL_PROVIDER', 'removebg');
    vi.stubEnv('REMOVE_BG_API_KEY', '');
    const res = await POST(makeReq({ image_base64: SMALL_B64, media_type: 'image/jpeg' }));
    expect(res.status).toBe(503);
  });

  it('chiama remove.bg e ritorna l\'immagine su bianco (200)', async () => {
    vi.stubEnv('BG_REMOVAL_PROVIDER', 'removebg');
    vi.stubEnv('REMOVE_BG_API_KEY', 'test-key');
    const fakePng = new Uint8Array([1, 2, 3, 4]);
    const fetchMock = vi.fn(async () =>
      new Response(fakePng, { status: 200, headers: { 'content-type': 'image/png' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(makeReq({ image_base64: SMALL_B64, media_type: 'image/jpeg' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.media_type).toBe('image/png');
    expect(typeof json.image_base64).toBe('string');
    expect(json.image_base64.length).toBeGreaterThan(0);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain('api.remove.bg');
    expect((opts.headers as Record<string, string>)['X-Api-Key']).toBe('test-key');
  });

  it('429 se remove.bg risponde 429 (rate limit upstream)', async () => {
    vi.stubEnv('BG_REMOVAL_PROVIDER', 'removebg');
    vi.stubEnv('REMOVE_BG_API_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429 })));
    const res = await POST(makeReq({ image_base64: SMALL_B64, media_type: 'image/jpeg' }));
    expect(res.status).toBe(429);
  });

  it('502 se remove.bg risponde 500 (errore upstream)', async () => {
    vi.stubEnv('BG_REMOVAL_PROVIDER', 'removebg');
    vi.stubEnv('REMOVE_BG_API_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    const res = await POST(makeReq({ image_base64: SMALL_B64, media_type: 'image/jpeg' }));
    expect(res.status).toBe(502);
  });

  it('503 se remove.bg risponde 402 (credito esaurito)', async () => {
    vi.stubEnv('BG_REMOVAL_PROVIDER', 'removebg');
    vi.stubEnv('REMOVE_BG_API_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 402 })));
    const res = await POST(makeReq({ image_base64: SMALL_B64, media_type: 'image/jpeg' }));
    expect(res.status).toBe(503);
  });
});
