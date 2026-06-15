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

import { POST } from '@/app/api/ai/voice-product/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';
import { MODELS } from '@/lib/ai/client';

function makeReq(body: unknown): never {
  return new Request('http://localhost/api/ai/voice-product', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as never;
}

describe('POST /api/ai/voice-product', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    runMessageMock.mockResolvedValue({
      toolInput: { reply: 'Ok', patch: { name: 'Maglietta rossa', price: 15, stock: 3 } },
    });
  });

  it('503 senza chiave AI', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    expect((await POST(makeReq({ transcript: 'tre magliette rosse a 15 euro' }))).status).toBe(503);
  });
  it('400 se transcript troppo corto', async () => {
    expect((await POST(makeReq({ transcript: 'a' }))).status).toBe(400);
  });
  it('200: modello fast, tool voice_fill, patch con stock', async () => {
    const res = await POST(makeReq({ transcript: 'tre magliette rosse di cotone a 15 euro l\'una' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.patch).toMatchObject({ name: 'Maglietta rossa', price: 15, stock: 3 });
    const arg = runMessageMock.mock.calls[0][0];
    expect(arg.model).toBe(MODELS.fast);
    expect(arg.tool_choice).toMatchObject({ type: 'tool', name: 'voice_fill' });
    expect(JSON.stringify(arg.messages)).toContain('tre magliette rosse');
  });
});
