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

import { POST } from '@/app/api/ai/reviews-summary/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';
import { MODELS } from '@/lib/ai/client';

function makeReq(body: unknown): never {
  return new Request('http://localhost/api/ai/reviews-summary', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as never;
}

describe('POST /api/ai/reviews-summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    runMessageMock.mockResolvedValue({
      toolInput: { summary: 'Clienti soddisfatti.', pros: ['qualità', 'consegna'], cons: [], suggestions: ['più foto'] },
    });
  });

  it('400 senza recensioni', async () => {
    expect((await POST(makeReq({ reviews: [] }))).status).toBe(400);
  });
  it('200: sintesi con pro/contro/suggerimenti, modello fast', async () => {
    const res = await POST(makeReq({ reviews: [{ rating: 5, text: 'Ottimo!' }, { text: 'Veloce' }], productName: 'Maglietta' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.summary).toMatch(/soddisfatti/i);
    expect(json.pros).toEqual(['qualità', 'consegna']);
    expect(json.suggestions).toEqual(['più foto']);
    expect(json.count).toBe(2);
    const arg = runMessageMock.mock.calls[0][0];
    expect(arg.model).toBe(MODELS.fast);
    expect(JSON.stringify(arg.messages)).toContain('Ottimo!');
  });
});
