import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Test business logic di returns/create.
 * Auth + rate limit mockati (coperti da middleware.test.ts).
 */

const FAKE_USER = { id: 'buyer-1', email: 'b@x.com' };

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit: (_opts: unknown, handler: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) =>
    (req: Request) => handler({ user: FAKE_USER, req }),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

// Configurabile per-test: risultati delle query
type QueryResult = { data: unknown; error: unknown };
const results: {
  order: QueryResult;
  existingReturn: QueryResult;
  insertReturn: QueryResult;
} = {
  order: { data: null, error: null },
  existingReturn: { data: null, error: null },
  insertReturn: { data: { id: 'ret-1' }, error: null },
};

// Server client: select orders (.single), select returns (.maybeSingle)
vi.mock('@/lib/supabase/server', () => {
  const serverFrom = vi.fn((table: string) => {
    if (table === 'orders') {
      return { select: () => ({ eq: () => ({ single: () => Promise.resolve(results.order) }) }) };
    }
    // returns existing check
    return {
      select: () => ({
        eq: () => ({ in: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve(results.existingReturn) }) }) }),
      }),
    };
  });
  const adminFrom = vi.fn((table: string) => {
    if (table === 'returns') {
      return { insert: () => ({ select: () => ({ single: () => Promise.resolve(results.insertReturn) }) }) };
    }
    // notifications
    return { insert: () => Promise.resolve({ error: null }) };
  });
  return {
    getServerSupabase: vi.fn(() => ({ from: serverFrom })),
    getAdminSupabase: vi.fn(() => ({ from: adminFrom })),
  };
});

import { POST } from '@/app/api/returns/create/route';

const UUID = '11111111-1111-1111-1111-111111111111';
function makeReq(body: unknown): never {
  return new Request('http://localhost/api/returns/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as never;
}

const deliveredOrder = {
  id: UUID,
  user_id: 'buyer-1',
  seller_id: 'seller-1',
  delivery_status: 'DELIVERED',
  delivered_at: new Date(Date.now() - 3 * 86_400_000).toISOString(), // 3gg fa
  total_price: 50,
};

describe('POST /api/returns/create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    results.order = { data: deliveredOrder, error: null };
    results.existingReturn = { data: null, error: null };
    results.insertReturn = { data: { id: 'ret-1' }, error: null };
  });

  it('rejects invalid body (bad UUID)', async () => {
    const res = await POST(makeReq({ orderId: 'not-uuid', reason: 'DAMAGED' }));
    expect(res.status).toBe(400);
  });

  it('rejects invalid reason enum', async () => {
    const res = await POST(makeReq({ orderId: UUID, reason: 'INVALID_REASON' }));
    expect(res.status).toBe(400);
  });

  it('404 se ordine non trovato', async () => {
    results.order = { data: null, error: { message: 'not found' } };
    const res = await POST(makeReq({ orderId: UUID, reason: 'DAMAGED' }));
    expect(res.status).toBe(404);
  });

  it('403 se non è il buyer dell ordine', async () => {
    results.order = { data: { ...deliveredOrder, user_id: 'other-user' }, error: null };
    const res = await POST(makeReq({ orderId: UUID, reason: 'DAMAGED' }));
    expect(res.status).toBe(403);
  });

  it('400 se ordine non DELIVERED', async () => {
    results.order = { data: { ...deliveredOrder, delivery_status: 'OUT_FOR_DELIVERY' }, error: null };
    const res = await POST(makeReq({ orderId: UUID, reason: 'DAMAGED' }));
    expect(res.status).toBe(400);
  });

  it('400 se oltre 14gg dalla consegna (recesso scaduto)', async () => {
    results.order = {
      data: { ...deliveredOrder, delivered_at: new Date(Date.now() - 20 * 86_400_000).toISOString() },
      error: null,
    };
    const res = await POST(makeReq({ orderId: UUID, reason: 'DAMAGED' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.message).toMatch(/recesso/i);
  });

  it('400 se esiste già un reso aperto', async () => {
    results.existingReturn = { data: { id: 'existing', status: 'REQUESTED' }, error: null };
    const res = await POST(makeReq({ orderId: UUID, reason: 'DAMAGED' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.message).toMatch(/già una richiesta/i);
  });

  it('201 con id+status REQUESTED su reso valido', async () => {
    const res = await POST(makeReq({ orderId: UUID, reason: 'DAMAGED', notes: 'Rotto' }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.id).toBe('ret-1');
    expect(json.status).toBe('REQUESTED');
  });

  it('500 se insert reso fallisce', async () => {
    results.insertReturn = { data: null, error: { message: 'insert failed' } };
    const res = await POST(makeReq({ orderId: UUID, reason: 'DAMAGED' }));
    expect(res.status).toBe(500);
  });
});
