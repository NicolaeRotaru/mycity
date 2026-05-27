import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase server - factory self-contained
const insertMock = vi.fn<(arg: Record<string, unknown>) => Promise<{ data: null; error: null | { message: string } }>>(() =>
  Promise.resolve({ data: null, error: null })
);
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: vi.fn(() => ({
    from: vi.fn(() => ({
      insert: insertMock,
    })),
  })),
}));

import { writeAudit } from '@/lib/audit';

describe('writeAudit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts audit row with all required fields', async () => {
    await writeAudit({
      actorId: 'admin-1',
      action: 'user.approve',
    });
    expect(insertMock).toHaveBeenCalledOnce();
    const call = insertMock.mock.calls[0][0];
    expect(call).toMatchObject({
      actor_id: 'admin-1',
      action: 'user.approve',
      target_table: null,
      target_id: null,
      metadata: null,
    });
  });

  it('passes all optional fields when provided', async () => {
    await writeAudit({
      actorId: 'admin-1',
      action: 'order.refund',
      targetTable: 'orders',
      targetId: 'order-123',
      metadata: { reason: 'damaged', amount: 50 },
      ip: '1.2.3.4',
      userAgent: 'Mozilla/5.0',
    });
    const call = insertMock.mock.calls[0][0];
    expect(call).toMatchObject({
      actor_id: 'admin-1',
      action: 'order.refund',
      target_table: 'orders',
      target_id: 'order-123',
      metadata: { reason: 'damaged', amount: 50 },
      ip: '1.2.3.4',
      user_agent: 'Mozilla/5.0',
    });
  });

  it('does not throw when DB insert fails (best-effort)', async () => {
    insertMock.mockResolvedValueOnce({ data: null, error: { message: 'DB down' } });
    // Should NOT throw
    await expect(writeAudit({ actorId: 'admin-1', action: 'kyc.approve' })).resolves.toBeUndefined();
  });

  it('handles getAdminSupabase exception silently', async () => {
    const { getAdminSupabase } = await import('@/lib/supabase/server');
    vi.mocked(getAdminSupabase).mockImplementationOnce(() => {
      throw new Error('No service key');
    });
    // Should NOT throw
    await expect(writeAudit({ actorId: 'admin-1', action: 'kyc.reject' })).resolves.toBeUndefined();
  });
});
