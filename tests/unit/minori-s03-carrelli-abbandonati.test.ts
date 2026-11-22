import { describe, it, expect, vi, beforeEach } from 'vitest';

/** S03 — il giro dei carrelli abbandonati e la sua potatura (schede 44, 84). */
const stato = vi.hoisted(() => ({ ora: 3, rpc: [] as string[], cancellate: [] as Array<Record<string, unknown>> }));
vi.mock('@/lib/tempo-piacenza', async (orig) => ({ ...(await orig<object>()), oraPiacenza: () => stato.ora }));
vi.mock('@/lib/api/middleware', () => ({ withCronAuth: (h: (r: unknown) => unknown) => (r: unknown) => h(r) }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    rpc: async (nome: string) => {
      stato.rpc.push(nome);
      return nome === 'list_abandoned_carts_to_recover'
        ? { data: [{ user_id: 'u1', email: 'a@b.it', full_name: 'Ada', cart_data: [], cart_total: 10, last_activity: new Date(Date.now() - 5 * 3_600_000).toISOString() }], error: null }
        : { data: true, error: null };
    },
    from: () => {
      const q: Record<string, unknown> = {};
      const filtri: Array<[string, unknown[]]> = [];
      Object.assign(q, {
        select: () => q, update: () => q, delete: () => q,
        in: async () => ({ data: [{ id: 'u1', email_marketing: true }], error: null }),
        eq: (...a: unknown[]) => (filtri.push(['eq', a]), q),
        lt: (...a: unknown[]) => (filtri.push(['lt', a]), q),
        is: (...a: unknown[]) => (filtri.push(['is', a]), q),
        then: (ok: (x: unknown) => unknown) => {
          stato.cancellate.push(Object.fromEntries(filtri.map(([m, a]) => [`${m}:${String(a[0])}`, a[1]])));
          return Promise.resolve({ data: [], error: null }).then(ok);
        },
      });
      return q;
    },
  }),
}));

import { sendEmail } from '@/lib/email/client';
import { potaCarrelliRecuperati } from '@/lib/carrelli-abbandonati';

async function giro(url = 'http://localhost/api/cron/abandoned-carts') {
  const { GET } = await import('@/app/api/cron/abandoned-carts/route');
  return (GET as unknown as (r: Request) => Promise<Response>)(new Request(url));
}
beforeEach(() => { stato.rpc.length = 0; stato.cancellate.length = 0; vi.mocked(sendEmail).mockClear(); });

describe('carrelli abbandonati', () => {
  it('44 — alle tre di notte il giro del calendario non spedisce e non tocca i carrelli', async () => {
    stato.ora = 3;
    const r = await giro();
    expect(await r.json()).toMatchObject({ ok: true, sent: 0 });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(stato.rpc).toEqual([]);
  });

  it('44 — controprova: alle dieci di mattina il promemoria parte', async () => {
    stato.ora = 10;
    await giro();
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('84 — la potatura prende anche i carrelli mai comprati e quelli recuperati senza data, oltre i 90 giorni', async () => {
    stato.cancellate.length = 0;
    const { getAdminSupabase } = await import('@/lib/supabase/server');
    await potaCarrelliRecuperati(getAdminSupabase() as never);
    const chiavi = stato.cancellate.map((f) => JSON.stringify(Object.keys(f).sort()));
    expect(stato.cancellate.some((f) => f['eq:recovered'] === false && 'lt:last_activity' in f)).toBe(true);
    expect(stato.cancellate.some((f) => f['eq:recovered'] === true && f['is:recovered_at'] === null && 'lt:last_activity' in f)).toBe(true);
    expect(stato.cancellate.some((f) => f['eq:recovered'] === true && 'lt:recovered_at' in f)).toBe(true);
    expect(chiavi.length).toBe(3);
  });
});
