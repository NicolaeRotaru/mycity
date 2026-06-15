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

import { POST } from '@/app/api/ai/seo/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';
import { MODELS } from '@/lib/ai/client';

function makeReq(body: unknown): never {
  return new Request('http://localhost/api/ai/seo', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as never;
}
const PRODUCT = { product: { name: 'Maglietta', price: 10 } };

describe('POST /api/ai/seo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    runMessageMock.mockResolvedValue({ toolInput: { reply: 'ok', patch: { name: 'Maglietta cotone', tags: ['Cotone', 'cotone', 'ESTATE'] } } });
  });

  it('503 senza chiave AI', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    expect((await POST(makeReq(PRODUCT))).status).toBe(503);
  });
  it('400 senza prodotto', async () => {
    expect((await POST(makeReq({}))).status).toBe(400);
  });
  it('200: modello fast, tool seo_optimize, tag normalizzati', async () => {
    const res = await POST(makeReq(PRODUCT));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.patch.name).toBe('Maglietta cotone');
    expect(json.patch.tags).toEqual(['cotone', 'estate']); // lowercase + dedup
    const arg = runMessageMock.mock.calls[0][0];
    expect(arg.model).toBe(MODELS.fast);
    expect(arg.tool_choice).toMatchObject({ type: 'tool', name: 'seo_optimize' });
  });
  it('429 dopo 30 chiamate/ora', async () => {
    for (let i = 0; i < 30; i++) expect((await POST(makeReq(PRODUCT))).status).toBe(200);
    expect((await POST(makeReq(PRODUCT))).status).toBe(429);
  });
});
