import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Test business logic di account/export + account/delete.
 *
 * Strategia: mockiamo withAuth/withAuthRateLimit per iniettare un user
 * fittizio e testare l'handler in isolamento (l'auth enforcement vero
 * è coperto da tests/unit/middleware.test.ts).
 */

const FAKE_USER = { id: 'user-123', email: 'test@user.com' };

vi.mock('@/lib/api/middleware', () => ({
  withAuth: (handler: (ctx: { user: typeof FAKE_USER }) => unknown) =>
    () => handler({ user: FAKE_USER }),
  withAuthRateLimit: (_opts: unknown, handler: (ctx: { user: typeof FAKE_USER }) => unknown) =>
    () => handler({ user: FAKE_USER }),
}));

// Supabase admin mock — query builder chainable
const fromResults: Record<string, unknown> = {};
function makeChain(table: string) {
  const chain: Record<string, unknown> = {};
  const methods = ['select', 'eq', 'single', 'update', 'insert', 'order', 'limit'];
  for (const m of methods) {
    chain[m] = vi.fn(() => {
      // single() / update().eq() risolvono la promise; gli altri sono chainable
      if (m === 'single') return Promise.resolve(fromResults[table] ?? { data: null, error: null });
      return chain;
    });
  }
  // Rende la chain thenable (per await admin.from(x).select(...).eq(...))
  (chain as { then?: unknown }).then = (resolve: (v: unknown) => void) =>
    resolve(fromResults[table] ?? { data: [], error: null });
  return chain;
}

const adminFromMock = vi.fn((table: string) => makeChain(table));
const deleteUserMock = vi.fn(() => Promise.resolve({ error: null }));

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: vi.fn(() => ({
    from: adminFromMock,
    auth: { admin: { deleteUser: deleteUserMock } },
  })),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { GET as exportGET } from '@/app/api/account/export/route';
import { POST as deletePOST, DELETE as deleteCancel, GET as deleteStatus } from '@/app/api/account/delete/route';

describe('GET /api/account/export (GDPR Art.20)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of Object.keys(fromResults)) delete fromResults[k];
  });

  it('returns JSON attachment with correct filename', async () => {
    const res = await (exportGET as unknown as () => Promise<Response>)();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const cd = res.headers.get('content-disposition') ?? '';
    expect(cd).toContain('attachment');
    expect(cd).toContain('mycity-data-user-123-');
    expect(cd).toContain('.json');
  });

  it('no-store cache header (dati sensibili)', async () => {
    const res = await (exportGET as unknown as () => Promise<Response>)();
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('payload ha export_metadata con gdpr_article 20 + user info', async () => {
    const res = await (exportGET as unknown as () => Promise<Response>)();
    const json = await res.json();
    expect(json.export_metadata.gdpr_article).toBe(20);
    expect(json.export_metadata.user_id).toBe('user-123');
    expect(json.export_metadata.email).toBe('test@user.com');
  });

  it('payload include tutte le sezioni dati richieste', async () => {
    const res = await (exportGET as unknown as () => Promise<Response>)();
    const json = await res.json();
    for (const key of ['profile', 'addresses', 'orders_as_buyer', 'orders_as_seller', 'orders_as_rider', 'reviews', 'favorites', 'referrals', 'notifications']) {
      expect(json).toHaveProperty(key);
    }
    expect(json.reviews).toHaveProperty('products');
    expect(json.reviews).toHaveProperty('stores');
    expect(json.reviews).toHaveProperty('riders');
  });

  it('query addresses usa user_addresses (NON addresses — bug fix)', async () => {
    await (exportGET as unknown as () => Promise<Response>)();
    const tablesQueried = adminFromMock.mock.calls.map((c) => c[0]);
    expect(tablesQueried).toContain('user_addresses');
    expect(tablesQueried).not.toContain('addresses');
  });
});

describe('account/delete — cooldown 7gg (GDPR Art.17)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of Object.keys(fromResults)) delete fromResults[k];
  });

  it('POST: registra deletion_requested_at se non già richiesto', async () => {
    fromResults['profiles'] = { data: { deletion_requested_at: null }, error: null };
    const res = await (deletePOST as unknown as () => Promise<Response>)();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.requestedAt).toBeTruthy();
    expect(json.effectiveAt).toBeTruthy();
  });

  it('POST: idempotente se già richiesto (ritorna alreadyRequested)', async () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    fromResults['profiles'] = { data: { deletion_requested_at: past }, error: null };
    const res = await (deletePOST as unknown as () => Promise<Response>)();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.alreadyRequested).toBe(true);
    expect(json.requestedAt).toBe(past);
  });

  it('DELETE: annulla richiesta (unset flag)', async () => {
    fromResults['profiles'] = { data: null, error: null };
    const res = await (deleteCancel as unknown as () => Promise<Response>)();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it('GET: pending=false quando nessuna richiesta', async () => {
    fromResults['profiles'] = { data: { deletion_requested_at: null }, error: null };
    const res = await (deleteStatus as unknown as () => Promise<Response>)();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.pending).toBe(false);
  });

  it('GET: pending=true + daysRemaining quando richiesta attiva', async () => {
    const requestedAt = new Date(Date.now() - 2 * 86_400_000).toISOString(); // 2gg fa
    fromResults['profiles'] = { data: { deletion_requested_at: requestedAt }, error: null };
    const res = await (deleteStatus as unknown as () => Promise<Response>)();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.pending).toBe(true);
    expect(json.daysRemaining).toBeGreaterThanOrEqual(4); // 7 - 2 = ~5
    expect(json.daysRemaining).toBeLessThanOrEqual(5);
  });
});
