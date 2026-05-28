import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Test cron/process-deletions — GDPR hard-delete dopo cooldown 7gg.
 * withCronAuth è reale (testa anche CRON_SECRET enforcement).
 */

type ErrResult = { error: null | { message: string } };
const rpcMock = vi.fn<() => Promise<{ data: unknown; error: null | { message: string } }>>();
const updateEqMock = vi.fn<() => Promise<ErrResult>>(() => Promise.resolve({ error: null }));
const deleteUserMock = vi.fn<(id: string) => Promise<ErrResult>>(() => Promise.resolve({ error: null }));

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: vi.fn(() => ({
    rpc: rpcMock,
    from: vi.fn(() => ({ update: vi.fn(() => ({ eq: updateEqMock })) })),
    auth: { admin: { deleteUser: deleteUserMock } },
  })),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { POST } from '@/app/api/cron/process-deletions/route';

function makeReq(authHeader?: string): Request {
  const headers: Record<string, string> = {};
  if (authHeader) headers['authorization'] = authHeader;
  return new Request('http://localhost/api/cron/process-deletions', { method: 'POST', headers });
}

describe('POST /api/cron/process-deletions', () => {
  const savedEnv = process.env.CRON_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'secret123';
    rpcMock.mockResolvedValue({ data: [], error: null });
    updateEqMock.mockResolvedValue({ error: null });
    deleteUserMock.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    process.env.CRON_SECRET = savedEnv;
  });

  it('503 se CRON_SECRET non configurato', async () => {
    delete process.env.CRON_SECRET;
    const res = await POST(makeReq('Bearer x') as never);
    expect(res.status).toBe(503);
  });

  it('401 se bearer errato', async () => {
    const res = await POST(makeReq('Bearer wrong') as never);
    expect(res.status).toBe(401);
  });

  it('processed:0 quando nessun account scaduto', async () => {
    const res = await POST(makeReq('Bearer secret123') as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.processed).toBe(0);
    expect(rpcMock).toHaveBeenCalledWith('process_expired_deletions');
  });

  it('500 se RPC fallisce', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'RPC error' } });
    const res = await POST(makeReq('Bearer secret123') as never);
    expect(res.status).toBe(500);
  });

  it('anonimizza + hard-delete ogni utente scaduto', async () => {
    rpcMock.mockResolvedValueOnce({ data: [{ user_id: 'u1' }, { user_id: 'u2' }], error: null });
    const res = await POST(makeReq('Bearer secret123') as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.processed).toBe(2);
    expect(json.failed).toBe(0);
    expect(json.total).toBe(2);
    expect(deleteUserMock).toHaveBeenCalledTimes(2);
    expect(deleteUserMock).toHaveBeenCalledWith('u1');
    expect(deleteUserMock).toHaveBeenCalledWith('u2');
  });

  it('conta failed se auth deleteUser fallisce', async () => {
    rpcMock.mockResolvedValueOnce({ data: [{ user_id: 'u1' }], error: null });
    deleteUserMock.mockResolvedValueOnce({ error: { message: 'auth fail' } });
    const res = await POST(makeReq('Bearer secret123') as never);
    const json = await res.json();
    expect(json.processed).toBe(0);
    expect(json.failed).toBe(1);
    expect(json.errors[0]).toContain('u1');
  });

  it('fallback safe-anonymize se full update fallisce', async () => {
    rpcMock.mockResolvedValueOnce({ data: [{ user_id: 'u1' }], error: null });
    // full update fallisce, safe update riesce
    updateEqMock
      .mockResolvedValueOnce({ error: { message: 'full failed' } })
      .mockResolvedValueOnce({ error: null });
    const res = await POST(makeReq('Bearer secret123') as never);
    const json = await res.json();
    expect(json.processed).toBe(1); // recuperato col fallback
  });
});
