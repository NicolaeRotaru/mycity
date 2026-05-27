import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase client - factory self-contained
const insertMock = vi.fn<(arg: Record<string, unknown>) => Promise<{ data: null; error: null | { message: string } }>>(() =>
  Promise.resolve({ data: null, error: null })
);
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      insert: insertMock,
    })),
  },
}));

import { notify } from '@/lib/notifications';

describe('notify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts notification with required fields', async () => {
    await notify({
      userId: 'user-1',
      title: 'Ordine confermato',
    });
    expect(insertMock).toHaveBeenCalledOnce();
    expect(insertMock.mock.calls[0][0]).toMatchObject({
      user_id: 'user-1',
      title: 'Ordine confermato',
      body: null,
      link: null,
    });
  });

  it('passes optional body and link', async () => {
    await notify({
      userId: 'user-2',
      title: 'Reso approvato',
      body: 'Il tuo rimborso e\' in arrivo',
      link: '/orders/123',
    });
    expect(insertMock.mock.calls[0][0]).toMatchObject({
      user_id: 'user-2',
      title: 'Reso approvato',
      body: 'Il tuo rimborso e\' in arrivo',
      link: '/orders/123',
    });
  });

  it('does not throw when insert fails', async () => {
    insertMock.mockImplementationOnce(() => Promise.reject(new Error('DB error')));
    await expect(notify({ userId: 'u', title: 't' })).resolves.toBeUndefined();
  });

  it('swallows errors silently (best-effort semantics)', async () => {
    insertMock.mockImplementationOnce(() => { throw new Error('sync throw'); });
    // Should NOT throw — il fatto che le notifiche siano best-effort
    // significa che un fail non blocca l'azione principale.
    await expect(notify({ userId: 'u', title: 't' })).resolves.toBeUndefined();
  });
});
