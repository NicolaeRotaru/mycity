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

import { POST } from '@/app/api/ai/barcode-lookup/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';
import { MODELS } from '@/lib/ai/client';

function makeReq(body: unknown): never {
  return new Request('http://localhost/api/ai/barcode-lookup', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as never;
}

describe('POST /api/ai/barcode-lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    runMessageMock.mockResolvedValue({
      toolInput: { found: true, reply: 'Trovato', patch: { name: 'Nutella 400g', price: 3.5, attributes: { marca: 'Ferrero' } } },
    });
  });

  it('503 senza chiave AI', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    expect((await POST(makeReq({ ean: '80176217' }))).status).toBe(503);
  });
  it('400 EAN non valido', async () => {
    expect((await POST(makeReq({ ean: '123' }))).status).toBe(400);
  });
  it('200 trovato: smart + web_search, patch con EAN garantito negli attributi', async () => {
    const res = await POST(makeReq({ ean: '8000500310427' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.found).toBe(true);
    expect(json.patch.name).toBe('Nutella 400g');
    expect(json.patch.attributes.ean).toBe('8000500310427'); // garantito anche se il modello non lo rimette
    expect(json.patch.attributes.marca).toBe('Ferrero');
    const arg = runMessageMock.mock.calls[0][0];
    expect(arg.model).toBe(MODELS.smart);
    expect(arg.tools.some((t: { name?: string }) => t.name === 'barcode_fill')).toBe(true);
    expect(arg.tools.some((t: { name?: string }) => t.name === 'web_search')).toBe(true);
  });
  it('200 non trovato: found=false, patch vuoto', async () => {
    runMessageMock.mockResolvedValue({ toolInput: { found: false } });
    const res = await POST(makeReq({ ean: '8000500310427' }));
    const json = await res.json();
    expect(json.found).toBe(false);
    expect(json.patch).toEqual({});
  });
});
