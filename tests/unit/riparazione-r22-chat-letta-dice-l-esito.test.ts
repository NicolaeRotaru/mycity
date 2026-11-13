import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R22-012 (13/11/2026) — in POST /api/chat/mark-read l'azzeramento del contatore non guardava il
 * suo esito: se la scrittura cadeva la rotta rispondeva ok lo stesso, e il «non letto» restava.
 */

const CONV = '11111111-1111-4111-8111-111111111111';
const stato: { erroreContatore: { message: string } | null } = { erroreContatore: null };

vi.mock('@/lib/logger', () => ({ logger: { error: () => undefined, warn: () => undefined, info: () => undefined } }));
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit: (_o: unknown, h: (ctx: { user: { id: string }; req: Request }) => unknown) => (req: Request) =>
    h({ user: { id: 'forno-1' }, req }),
}));
vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({
    rpc: async () => ({ data: 1, error: null }),
    from: (t: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { buyer_id: 'cliente-1', seller_id: 'forno-1' }, error: null }) }) }),
      update: () => {
        const esito = t === 'conversations' ? { error: stato.erroreContatore } : { error: null };
        const c: Record<string, unknown> = {};
        c.eq = () => c;
        c.then = (ok: (x: unknown) => unknown) => Promise.resolve(esito).then(ok);
        return c;
      },
    }),
  }),
}));

import { POST } from '@/app/api/chat/mark-read/route';

const segna = () =>
  (POST as unknown as (r: Request) => Promise<Response>)(
    new Request('http://localhost/api/chat/mark-read', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId: CONV }),
    }),
  );

beforeEach(() => { stato.erroreContatore = null; });

describe('R22-012 · segnare letto dice se il contatore si è azzerato', () => {
  it('contatore azzerato: ok', async () => {
    const res = await segna();
    expect(res.status).toBe(200);
  });
  it('contatore non azzerato: la rotta non risponde ok', async () => {
    stato.erroreContatore = { message: 'permission denied for table conversations' };
    const res = await segna();
    expect(res.status, 'la scrittura del contatore è caduta e la rotta ha risposto ok').toBe(500);
  });
});
