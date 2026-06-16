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

import { POST } from '@/app/api/ai/variants/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';
import { MODELS } from '@/lib/ai/client';

function makeReq(body: unknown): never {
  return new Request('http://localhost/api/ai/variants', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as never;
}
const FIELDS = [
  { key: 'taglia', label: 'Taglia', type: 'select', options: ['S', 'M', 'L'] },
  { key: 'colore', label: 'Colore', type: 'text' },
];
const BASE = { product: { name: 'Maglietta' }, variantableFields: FIELDS };

describe('POST /api/ai/variants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    runMessageMock.mockResolvedValue({
      toolInput: {
        axes: [
          { key: 'taglia', values: ['s', 'M', 'XXL'] }, // 's'→'S', 'XXL' fuori opzioni → scartato
          { key: 'colore', values: ['Rosso', 'rosso', 'Blu'] }, // dedup case-insensitive
          { key: 'bogus', values: ['x'] }, // chiave non valida → scartata
        ],
      },
    });
  });

  it('503 senza chiave AI', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    expect((await POST(makeReq(BASE))).status).toBe(503);
  });
  it('400 senza prodotto', async () => {
    expect((await POST(makeReq({ variantableFields: FIELDS }))).status).toBe(400);
  });
  it('400 se la categoria non ha campi variante', async () => {
    expect((await POST(makeReq({ product: { name: 'X' }, variantableFields: [] }))).status).toBe(400);
  });
  it('200: normalizza assi (chiavi valide, opzioni select, dedup), modello smart', async () => {
    const res = await POST(makeReq(BASE));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.axes).toHaveLength(2);
    expect(json.axes[0]).toMatchObject({ key: 'taglia', values: ['S', 'M'] });
    expect(json.axes[1]).toMatchObject({ key: 'colore', values: ['Rosso', 'Blu'] });
    const arg = runMessageMock.mock.calls[0][0];
    expect(arg.model).toBe(MODELS.smart);
    expect(arg.tool_choice).toMatchObject({ type: 'tool', name: 'suggest_variants' });
  });
});
