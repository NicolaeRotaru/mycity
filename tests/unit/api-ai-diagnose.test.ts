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

import { POST } from '@/app/api/ai/diagnose/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';
import { MODELS } from '@/lib/ai/client';

function makeReq(body: unknown): never {
  return new Request('http://localhost/api/ai/diagnose', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as never;
}
const PRODUCT = { product: { name: 'Maglietta', price: 10 } };

describe('POST /api/ai/diagnose', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    runMessageMock.mockResolvedValue({
      toolInput: {
        summary: 'Foto deboli e prezzo alto.',
        score: 140, // fuori range → clamp 100
        issues: [
          { area: 'foto', severity: 'alta', fix: 'Aggiungi foto con luce naturale.' },
          { area: 'prezzo', severity: 'pippo', fix: 'Abbassa a 8€.' }, // severity invalida → media
          { area: 'x' }, // incompleto → scartato
        ],
        patch: { price: 8 },
      },
    });
  });

  it('400 senza prodotto', async () => {
    expect((await POST(makeReq({}))).status).toBe(400);
  });
  it('200: smart + web_search, score clampato, issues normalizzati, patch passthrough', async () => {
    const res = await POST(makeReq(PRODUCT));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.score).toBe(100);
    expect(json.issues).toHaveLength(2);
    expect(json.issues[1].severity).toBe('media');
    expect(json.patch).toEqual({ price: 8 });
    const arg = runMessageMock.mock.calls[0][0];
    expect(arg.model).toBe(MODELS.smart);
    expect(arg.tools.some((t: { name?: string }) => t.name === 'diagnose')).toBe(true);
    expect(arg.tools.some((t: { name?: string }) => t.name === 'web_search')).toBe(true);
  });
  it('502 se l\'AI non chiama il tool', async () => {
    runMessageMock.mockResolvedValue({ text: 'x' });
    expect((await POST(makeReq(PRODUCT))).status).toBe(502);
  });
});
