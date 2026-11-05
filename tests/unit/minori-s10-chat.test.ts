import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * S10 (5/11/2026, scheda 35) — aprire la chat segna come letti i messaggi
 * dell'altro passando dalla funzione del database, e l'esito si legge.
 */

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit: (_o: unknown, h: (ctx: { user: { id: string }; req: Request }) => unknown) => (req: Request) =>
    h({ user: { id: 'cliente-1' }, req }),
}));

const rpcMock = vi.fn();
const updateMessaggi = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({
    rpc: (...a: unknown[]) => rpcMock(...a),
    from: (t: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { buyer_id: 'cliente-1', seller_id: 'forno-1' }, error: null }) }) }),
      update: (v: unknown) => {
        if (t === 'messages') updateMessaggi(v);
        const c: Record<string, unknown> = {};
        c.eq = () => c;
        c.is = () => c;
        c.neq = () => c;
        c.then = (ok: (x: unknown) => unknown) => Promise.resolve({ error: null }).then(ok);
        return c;
      },
    }),
  }),
}));

import { POST } from '@/app/api/chat/mark-read/route';

const CONV = '11111111-1111-4111-8111-111111111111';
const segna = () =>
  POST(
    new Request('http://localhost/api/chat/mark-read', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId: CONV }),
    }) as never,
  );

beforeEach(() => vi.clearAllMocks());

describe('«letto» passa dalla funzione del database (35)', () => {
  it('chiama mark_conversation_read con la conversazione', async () => {
    rpcMock.mockResolvedValue({ data: 2, error: null });
    const res = await segna();
    expect(res.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith('mark_conversation_read', { p_conversation_id: CONV });
    expect(updateMessaggi).not.toHaveBeenCalled();
  });
  it('se la funzione fallisce, la rotta non risponde ok', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'permission denied' } });
    const res = await segna();
    expect(res.status).toBe(500);
  });
});
