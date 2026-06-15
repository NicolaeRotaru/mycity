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

import { POST } from '@/app/api/ai/answer-qa/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

function makeReq(body: unknown): never {
  return new Request('http://localhost/api/ai/answer-qa', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as never;
}
const PRODUCT = { product: { name: 'Maglietta', description: '100% cotone' } };

describe('POST /api/ai/answer-qa', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    runMessageMock.mockResolvedValue({ toolInput: { answer: 'Sì, è 100% cotone.', needs_seller_input: false } });
  });

  it('400 senza prodotto', async () => {
    expect((await POST(makeReq({ question: 'È di cotone?' }))).status).toBe(400);
  });
  it('400 senza domanda', async () => {
    expect((await POST(makeReq(PRODUCT))).status).toBe(400);
  });
  it('200: bozza di risposta + needsSellerInput', async () => {
    const res = await POST(makeReq({ ...PRODUCT, question: 'È di cotone?' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.answer).toMatch(/cotone/i);
    expect(json.needsSellerInput).toBe(false);
    expect(JSON.stringify(runMessageMock.mock.calls[0][0].messages)).toContain('È di cotone?');
  });
  it('502 se la bozza è vuota', async () => {
    runMessageMock.mockResolvedValue({ toolInput: { answer: '' } });
    expect((await POST(makeReq({ ...PRODUCT, question: 'È di cotone?' }))).status).toBe(502);
  });
});
