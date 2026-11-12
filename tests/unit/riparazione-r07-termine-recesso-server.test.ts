import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * R07-005 (12/11/2026) — il termine del recesso si conta a giorni di calendario di
 * Piacenza. Il quattordicesimo giorno il server rifiutava il reso dall'ora della
 * consegna in poi, e col cambio d'ora anche un'ora prima.
 */

const FAKE_USER = { id: 'buyer-1', email: 'b@x.com' };

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit: (_opts: unknown, handler: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) =>
    (req: Request) => handler({ user: FAKE_USER, req }),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() },
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

function ordineConsegnato(deliveredAt: string | null, createdAt = '2026-02-01T10:00:00Z') {
  return {
    id: UUID, user_id: 'buyer-1', seller_id: 'seller-1', delivery_status: 'DELIVERED',
    delivered_at: deliveredAt, created_at: createdAt, total_price: 50,
  };
}
async function chiedi(ora: string, deliveredAt: string | null, createdAt?: string) {
  vi.setSystemTime(new Date(ora));
  results.order = { data: ordineConsegnato(deliveredAt, createdAt), error: null };
  const res = await POST(makeReq({ orderId: UUID, reason: 'DAMAGED' }));
  const json = await res.clone().json().catch(() => ({}));
  const scaduto = res.status === 400 && /recesso/i.test(JSON.stringify(json));
  return { status: res.status, scaduto };
}

describe('R07-005 · il termine del recesso a giorni di calendario', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    results.existingReturn = { data: null, error: null };
    results.insertReturn = { data: { id: 'ret-1' }, error: null };
  });
  afterEach(() => vi.useRealTimers());

  it('consegna il 1/3 alle 10:00: il 15/3 alle 18:00 il reso si chiede ancora', async () => {
    const r = await chiedi('2026-03-15T17:00:00Z', '2026-03-01T09:00:00Z');
    expect(r.scaduto).toBe(false);
    expect(r.status).toBe(201);
  });

  it('il 15/3 alle 23:30 di Piacenza è ancora l ultimo giorno', async () => {
    const r = await chiedi('2026-03-15T22:30:00Z', '2026-03-01T09:00:00Z');
    expect(r.scaduto).toBe(false);
  });

  it('il 16/3 alle 00:30 di Piacenza il termine è scaduto', async () => {
    const r = await chiedi('2026-03-15T23:30:00Z', '2026-03-01T09:00:00Z');
    expect(r.scaduto).toBe(true);
  });

  it('a cavallo del cambio d ora (25/10): consegna il 20/10 alle 10, il 3/11 alle 09:30 si chiede ancora', async () => {
    // 20/10 10:00 CEST = 08:00Z; 3/11 09:30 CET = 08:30Z: più di 14×24 ore, ma è ancora il quattordicesimo giorno,
    // e perfino prima dell'ora della consegna.
    const r = await chiedi('2026-11-03T08:30:00Z', '2026-10-20T08:00:00Z');
    expect(r.scaduto).toBe(false);
  });

  it('senza data di consegna si conta dalla data dell ordine', async () => {
    expect((await chiedi('2026-02-15T20:00:00Z', null, '2026-02-01T10:00:00Z')).scaduto).toBe(false);
    expect((await chiedi('2026-02-16T08:00:00Z', null, '2026-02-01T10:00:00Z')).scaduto).toBe(true);
  });
});
