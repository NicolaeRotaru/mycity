import { describe, it, expect, beforeEach, vi } from 'vitest';

const FAKE_USER = { id: 'seller-1', email: 's@x.com' };
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth: (h: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) => (req: Request) => h({ user: FAKE_USER, req }),
}));

const PRODUCTS = [
  { id: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'TV', description: '', price: 20, compare_at_price: null, unit: 'pezzo', condition: null, stock: 5, status: 'available', category_id: 'el', images: [], attributes: {}, tags: [], has_variants: false },
  { id: 'aaaaaaaa-0000-0000-0000-000000000002', name: 'Radio', description: '', price: 10, compare_at_price: null, unit: 'pezzo', condition: null, stock: 0, status: 'available', category_id: 'el', images: [], attributes: {}, tags: [], has_variants: false },
];
const CATEGORIES = [{ id: 'el', name: 'Elettronica', slug: 'elettronica', parent_id: null }];

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (table: string) =>
      table === 'products'
        ? { select: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: PRODUCTS, error: null }) }) }) }) }
        : { select: () => ({ order: () => Promise.resolve({ data: CATEGORIES, error: null }) }) },
  }),
}));

const runMessageMock = vi.fn();
vi.mock('@/lib/ai/run', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/run')>();
  return { ...actual, runMessage: (...a: unknown[]) => runMessageMock(...a) };
});

import { POST } from '@/app/api/ai/copilot/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';
import { MODELS } from '@/lib/ai/client';

function makeReq(body: unknown): never {
  return new Request('http://localhost/api/ai/copilot', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as never;
}

describe('POST /api/ai/copilot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    runMessageMock.mockResolvedValue({
      toolInput: {
        reply: 'Ho preparato 1 modifica.',
        changes: [
          { product_id: 'aaaaaaaa-0000-0000-0000-000000000001', patch: { price: 18 } }, // valido
          { product_id: 'unknown', patch: { price: 1 } }, // non del venditore → scartato
          { product_id: 'aaaaaaaa-0000-0000-0000-000000000002', patch: {} }, // patch vuoto → scartato
        ],
      },
    });
  });

  it('503 senza chiave AI', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    expect((await POST(makeReq({ instruction: 'abbassa del 10%' }))).status).toBe(503);
  });
  it('400 senza istruzione', async () => {
    expect((await POST(makeReq({}))).status).toBe(400);
  });
  it('200: valida le modifiche (solo prodotti del venditore, patch non vuoti), modello smart', async () => {
    const res = await POST(makeReq({ instruction: 'abbassa del 10% l\'elettronica' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.reply).toMatch(/modifica/i);
    expect(json.changes).toHaveLength(1);
    expect(json.changes[0]).toMatchObject({ product_id: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'TV', patch: { price: 18 } });
    expect(runMessageMock.mock.calls[0][0].model).toBe(MODELS.smart);
  });
});
