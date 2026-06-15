import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Route creazione massiva bozze: auth mockata; admin Supabase mockato; rate
 * limit reale. Verifica build dei payload (status draft, seller_id), conteggio,
 * mapping errori.
 */

const FAKE_USER = { id: 'seller-1', email: 's@x.com' };

vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth: (handler: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) =>
    (req: Request) => handler({ user: FAKE_USER, req }),
}));

const CATEGORIES = [
  { id: 'casa-top', name: 'Casa', slug: 'casa', parent_id: null },
];

const insertSelectMock = vi.fn();
const insertMock = vi.fn();
const fromMock = vi.fn((table: string) => {
  if (table === 'categories') {
    return { select: () => ({ order: () => Promise.resolve({ data: CATEGORIES, error: null }) }) };
  }
  return { insert: insertMock };
});

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({ from: fromMock }),
}));

import { POST } from '@/app/api/ai/catalog-create-bulk/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

function makeReq(body: unknown): never {
  return new Request('http://localhost/api/ai/catalog-create-bulk', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as never;
}

const ITEM = {
  imageUrls: ['https://x/a.jpg'],
  draft: { name: 'Lampada', category_slug: 'casa', suggested_price: 9.9 },
};

describe('POST /api/ai/catalog-create-bulk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    insertMock.mockReturnValue({ select: insertSelectMock });
    insertSelectMock.mockResolvedValue({
      data: [
        { id: 'p1', name: 'Lampada', price: 9.9, category_id: 'casa-top', images: ['https://x/a.jpg'], tags: [], attributes: {} },
      ],
      error: null,
    });
  });

  it('400 su JSON non valido', async () => {
    const res = await POST(makeReq('non-json'));
    expect(res.status).toBe(400);
  });

  it('400 se items è vuoto', async () => {
    const res = await POST(makeReq({ items: [] }));
    expect(res.status).toBe(400);
  });

  it('200: inserisce N bozze e ritorna il conteggio', async () => {
    const res = await POST(makeReq({ items: [ITEM, ITEM] }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.count).toBe(1); // il mock ritorna 1 riga
    // insert chiamato con un array di 2 payload, tutti draft + seller_id corretto.
    const payloads = insertMock.mock.calls[0][0];
    expect(Array.isArray(payloads)).toBe(true);
    expect(payloads).toHaveLength(2);
    expect(payloads[0]).toMatchObject({ status: 'draft', seller_id: 'seller-1', category_id: 'casa-top' });
  });

  it('400 se nessun item ha foto http valide', async () => {
    // ftp:// passa z.string().url() ma non il filtro http → nessun payload.
    const res = await POST(makeReq({ items: [{ imageUrls: ['ftp://x/a.jpg'], draft: { name: 'X' } }] }));
    expect(res.status).toBe(400);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('502 se l\'insert fallisce', async () => {
    insertSelectMock.mockResolvedValue({ data: null, error: { code: '23505' } });
    const res = await POST(makeReq({ items: [ITEM] }));
    expect(res.status).toBe(502);
  });

  it('429 dopo 10 chiamate/ora', async () => {
    for (let i = 0; i < 10; i++) {
      const ok = await POST(makeReq({ items: [ITEM] }));
      expect(ok.status).toBe(200);
    }
    const res = await POST(makeReq({ items: [ITEM] }));
    expect(res.status).toBe(429);
  });
});
