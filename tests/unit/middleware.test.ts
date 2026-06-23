import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// Mock supabase: factory self-contained per evitare hoisting issue.
// NB (audit 🔴-1): la lettura del profilo avviene via service-role
// (getAdminSupabase), NON via client anon. Quindi `mockProfileSingle` è
// cablato sul client admin; `mockAnonProfileSingle` rappresenta cosa vedrebbe
// il client anon (RLS) e NON deve essere usato per il profilo.
const mockAuthGetUser = vi.fn();
const mockProfileSingle = vi.fn(); // profilo letto via admin (post-fix)
const mockAnonProfileSingle = vi.fn(); // client anon: non usato per il profilo

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: mockAuthGetUser },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: mockAnonProfileSingle,
        })),
      })),
    })),
  })),
}));

vi.mock('@/lib/supabase/server', () => ({
  getCurrentUser: vi.fn(),
  getAdminSupabase: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: mockProfileSingle,
        })),
      })),
    })),
  })),
}));

// Per disabilitare rate limit cross-test (in-memory persiste)
vi.mock('@/lib/rate-limit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rate-limit')>('@/lib/rate-limit');
  return actual;
});

import {
  withAuth,
  withAuthRateLimit,
  withAdminAuth,
  withAdminAuthRateLimit,
  withSellerAuth,
  withCronAuth,
} from '@/lib/api/middleware';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

function makeReq(headers: Record<string, string> = {}, path = 'http://localhost/api/test'): NextRequest {
  const h = new Headers(headers);
  return {
    headers: h,
    nextUrl: { pathname: '/api/test' },
    url: path,
  } as unknown as NextRequest;
}

const mockUser = { id: 'user-1', email: 'u@test.com' };
const mockBuyerProfile = { id: 'user-1', role: 'buyer', is_approved: false };
const mockSellerProfile = { id: 'user-1', role: 'seller', is_approved: true };
const mockAdminProfile = { id: 'user-1', role: 'admin', is_approved: true };

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  vi.clearAllMocks();
  mockAuthGetUser.mockReset();
  mockProfileSingle.mockReset();
  mockAnonProfileSingle.mockReset();
  // Default: il client anon NON espone il profilo (simula RLS con auth.uid()=NULL)
  mockAnonProfileSingle.mockResolvedValue({ data: null });
  __resetRateLimitBuckets();
});

describe('withAuth', () => {
  it('returns 401 when no bearer + no cookie session', async () => {
    const handler = vi.fn();
    const wrapped = withAuth(handler);
    const res = await wrapped(makeReq());
    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it('passes through to handler when bearer is valid', async () => {
    mockAuthGetUser.mockResolvedValue({ data: { user: mockUser }, error: null });
    mockProfileSingle.mockResolvedValue({ data: mockBuyerProfile });

    const handler = vi.fn(async () => ({ status: 200 } as unknown as Response));
    const wrapped = withAuth(handler as never);
    await wrapped(makeReq({ authorization: 'Bearer valid-token' }));

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ user: mockUser, profile: mockBuyerProfile }),
    );
  });

  it('returns 403 when profile missing (orphan auth user)', async () => {
    mockAuthGetUser.mockResolvedValue({ data: { user: mockUser }, error: null });
    mockProfileSingle.mockResolvedValue({ data: null });

    const handler = vi.fn();
    const wrapped = withAuth(handler);
    const res = await wrapped(makeReq({ authorization: 'Bearer x' }));
    expect(res.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it('[🔴-1] legge il profilo via service-role: un buyer non-pubblico (invisibile ad anon) passa', async () => {
    // RLS: il client anon NON vede la riga del buyer (auth.uid()=NULL).
    mockAnonProfileSingle.mockResolvedValue({ data: null });
    // Il client admin (service-role) bypassa RLS e trova il profilo.
    mockAuthGetUser.mockResolvedValue({ data: { user: mockUser }, error: null });
    mockProfileSingle.mockResolvedValue({ data: mockBuyerProfile });

    const handler = vi.fn(async () => ({ status: 200 } as unknown as Response));
    await withAuth(handler as never)(makeReq({ authorization: 'Bearer x' }));

    // Col codice vecchio (profilo letto via anon → null) questo sarebbe 403.
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ user: mockUser, profile: mockBuyerProfile }),
    );
  });

  it('[🔴-1] la lettura del profilo NON dipende dal client anon', async () => {
    // Anche se l'anon restituisse un profilo, conta solo l'admin.
    mockAnonProfileSingle.mockResolvedValue({ data: { id: 'x', role: 'admin', is_approved: true } });
    mockAuthGetUser.mockResolvedValue({ data: { user: mockUser }, error: null });
    mockProfileSingle.mockResolvedValue({ data: null }); // admin non trova → 403

    const handler = vi.fn();
    const res = await withAuth(handler)(makeReq({ authorization: 'Bearer x' }));
    expect(res.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('withAdminAuth', () => {
  it('forbids buyer', async () => {
    mockAuthGetUser.mockResolvedValue({ data: { user: mockUser }, error: null });
    mockProfileSingle.mockResolvedValue({ data: mockBuyerProfile });

    const handler = vi.fn();
    const res = await withAdminAuth(handler)(makeReq({ authorization: 'Bearer x' }));
    expect(res.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it('allows admin', async () => {
    mockAuthGetUser.mockResolvedValue({ data: { user: mockUser }, error: null });
    mockProfileSingle.mockResolvedValue({ data: mockAdminProfile });

    const handler = vi.fn(async () => ({ status: 200 } as unknown as Response));
    await withAdminAuth(handler as never)(makeReq({ authorization: 'Bearer x' }));
    expect(handler).toHaveBeenCalledOnce();
  });
});

describe('withSellerAuth', () => {
  it('forbids buyer', async () => {
    mockAuthGetUser.mockResolvedValue({ data: { user: mockUser }, error: null });
    mockProfileSingle.mockResolvedValue({ data: mockBuyerProfile });
    const res = await withSellerAuth(vi.fn())(makeReq({ authorization: 'Bearer x' }));
    expect(res.status).toBe(403);
  });

  it('forbids non-approved seller', async () => {
    mockAuthGetUser.mockResolvedValue({ data: { user: mockUser }, error: null });
    mockProfileSingle.mockResolvedValue({ data: { ...mockSellerProfile, is_approved: false } });
    const res = await withSellerAuth(vi.fn())(makeReq({ authorization: 'Bearer x' }));
    expect(res.status).toBe(403);
  });

  it('allows approved seller', async () => {
    mockAuthGetUser.mockResolvedValue({ data: { user: mockUser }, error: null });
    mockProfileSingle.mockResolvedValue({ data: mockSellerProfile });
    const handler = vi.fn(async () => ({ status: 200 } as unknown as Response));
    await withSellerAuth(handler as never)(makeReq({ authorization: 'Bearer x' }));
    expect(handler).toHaveBeenCalledOnce();
  });

  it('allows admin (bypass seller check)', async () => {
    mockAuthGetUser.mockResolvedValue({ data: { user: mockUser }, error: null });
    mockProfileSingle.mockResolvedValue({ data: mockAdminProfile });
    const handler = vi.fn(async () => ({ status: 200 } as unknown as Response));
    await withSellerAuth(handler as never)(makeReq({ authorization: 'Bearer x' }));
    expect(handler).toHaveBeenCalledOnce();
  });
});

describe('withAuthRateLimit', () => {
  it('passes first N requests, rejects N+1 with 429', async () => {
    mockAuthGetUser.mockResolvedValue({ data: { user: { ...mockUser, id: 'rl-user-1' } }, error: null });
    mockProfileSingle.mockResolvedValue({ data: mockBuyerProfile });

    const handler = vi.fn(async () => ({ status: 200 } as unknown as Response));
    const wrapped = withAuthRateLimit({ name: 'test-rl-1', max: 2, windowMs: 60_000 }, handler as never);

    const r1 = await wrapped(makeReq({ authorization: 'Bearer x' }));
    const r2 = await wrapped(makeReq({ authorization: 'Bearer x' }));
    const r3 = await wrapped(makeReq({ authorization: 'Bearer x' }));

    expect(handler).toHaveBeenCalledTimes(2);
    expect(r1.status).not.toBe(429);
    expect(r2.status).not.toBe(429);
    expect(r3.status).toBe(429);
    expect(r3.headers.get('Retry-After')).toBeTruthy();
  });

  it('rate limit is per-user (different users have separate counters)', async () => {
    const handler = vi.fn(async () => ({ status: 200 } as unknown as Response));
    const wrapped = withAuthRateLimit({ name: 'test-rl-2', max: 1, windowMs: 60_000 }, handler as never);

    mockAuthGetUser.mockResolvedValue({ data: { user: { ...mockUser, id: 'rl-user-a' } }, error: null });
    mockProfileSingle.mockResolvedValue({ data: mockBuyerProfile });
    const a1 = await wrapped(makeReq({ authorization: 'Bearer x' }));
    const a2 = await wrapped(makeReq({ authorization: 'Bearer x' }));

    mockAuthGetUser.mockResolvedValue({ data: { user: { ...mockUser, id: 'rl-user-b' } }, error: null });
    const b1 = await wrapped(makeReq({ authorization: 'Bearer y' }));

    expect(a1.status).not.toBe(429);
    expect(a2.status).toBe(429); // user A esaurito
    expect(b1.status).not.toBe(429); // user B ha la sua quota
  });

  it('rejects with 401 BEFORE checking rate limit (auth-first)', async () => {
    mockAuthGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid' } });

    const handler = vi.fn();
    const wrapped = withAuthRateLimit({ name: 'test-rl-3', max: 5, windowMs: 60_000 }, handler);

    const res = await wrapped(makeReq({ authorization: 'Bearer bad' }));
    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('withAdminAuthRateLimit', () => {
  it('combines admin check + rate limit', async () => {
    mockAuthGetUser.mockResolvedValue({ data: { user: { ...mockUser, id: 'rl-admin-1' } }, error: null });
    mockProfileSingle.mockResolvedValue({ data: mockAdminProfile });

    const handler = vi.fn(async () => ({ status: 200 } as unknown as Response));
    const wrapped = withAdminAuthRateLimit({ name: 'test-admin-rl', max: 1, windowMs: 60_000 }, handler as never);

    const r1 = await wrapped(makeReq({ authorization: 'Bearer x' }));
    const r2 = await wrapped(makeReq({ authorization: 'Bearer x' }));

    expect(r1.status).not.toBe(429);
    expect(r2.status).toBe(429);
  });

  it('forbids non-admin even with rate limit unused', async () => {
    mockAuthGetUser.mockResolvedValue({ data: { user: mockUser }, error: null });
    mockProfileSingle.mockResolvedValue({ data: mockBuyerProfile });

    const wrapped = withAdminAuthRateLimit({ name: 'test-admin-rl-2', max: 5, windowMs: 60_000 }, vi.fn());
    const res = await wrapped(makeReq({ authorization: 'Bearer x' }));
    expect(res.status).toBe(403);
  });
});

describe('withCronAuth', () => {
  it('returns 503 when CRON_SECRET not configured', async () => {
    delete process.env.CRON_SECRET;
    const res = await withCronAuth(vi.fn())(makeReq());
    expect(res.status).toBe(503);
  });

  it('returns 401 when bearer wrong', async () => {
    process.env.CRON_SECRET = 'secret123';
    const res = await withCronAuth(vi.fn())(makeReq({ authorization: 'Bearer wrong' }));
    expect(res.status).toBe(401);
  });

  it('passes through when bearer matches', async () => {
    process.env.CRON_SECRET = 'secret123';
    const handler = vi.fn(async () => ({ status: 200 } as unknown as Response));
    await withCronAuth(handler as never)(makeReq({ authorization: 'Bearer secret123' }));
    expect(handler).toHaveBeenCalledOnce();
  });

  it('is constant-time-ish: strips bearer prefix correctly', async () => {
    process.env.CRON_SECRET = 'secret';
    const handler = vi.fn(async () => ({ status: 200 } as unknown as Response));
    // Variazioni case del prefisso Bearer
    await withCronAuth(handler as never)(makeReq({ authorization: 'bearer secret' }));
    await withCronAuth(handler as never)(makeReq({ authorization: 'BEARER secret' }));
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
