import { describe, it, expect, beforeEach, vi } from 'vitest';

const FAKE_USER = { id: 'seller-1', email: 's@x.com' };
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth: (h: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) => (req: Request) => h({ user: FAKE_USER, req }),
}));
const runMessageMock = vi.fn();
vi.mock('@/lib/ai/run', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/run')>();
  return { ...actual, runMessage: (...a: unknown[]) => runMessageMock(...a) };
});

import { POST } from '@/app/api/ai/translate/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

function makeReq(body: unknown): never {
  return new Request('http://localhost/api/ai/translate', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as never;
}
const BASE = { product: { name: 'Maglietta', description: 'Bella maglietta' } };

describe('POST /api/ai/translate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    runMessageMock.mockResolvedValue({ toolInput: { patch: { name: 'T-shirt', description: 'Nice t-shirt', tags: ['Cotton'] } } });
  });

  it('400 senza prodotto', async () => {
    expect((await POST(makeReq({ targetLang: 'en' }))).status).toBe(400);
  });
  it('400 lingua non supportata', async () => {
    expect((await POST(makeReq({ ...BASE, targetLang: 'xx' }))).status).toBe(400);
  });
  it('200: ritorna patch tradotto + tag normalizzati', async () => {
    const res = await POST(makeReq({ ...BASE, targetLang: 'en' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.patch).toMatchObject({ name: 'T-shirt', description: 'Nice t-shirt', tags: ['cotton'] });
    expect(json.lang).toBe('en');
  });
  it('502 se la traduzione è vuota', async () => {
    runMessageMock.mockResolvedValue({ toolInput: { patch: {} } });
    expect((await POST(makeReq({ ...BASE, targetLang: 'en' }))).status).toBe(502);
  });
});
