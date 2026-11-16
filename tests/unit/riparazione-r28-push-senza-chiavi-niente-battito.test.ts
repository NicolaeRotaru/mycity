import { describe, it, expect, vi } from 'vitest';
import { giroNonFatto } from '@/lib/cron/fermo-dei-lavori';

/**
 * R28-006 — Senza le chiavi VAPID il giro send-push risponde 200 senza mandare niente: non deve
 * lasciare il battito (withCronAuth non lo scrive se la risposta è «giro non avvenuto»).
 */
let configurato = false;
vi.mock('@/lib/api/middleware', () => ({ withCronAuth: (h: (req: unknown) => unknown) => (req: unknown) => h(req) }));
vi.mock('@/lib/push/send', () => ({
  isPushConfigured: () => configurato,
  iscrizioniPerUtenti: async () => new Map(),
  sendPushToUser: async () => ({ delivered: 0, total: 0 }),
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    rpc: async () => ({ data: true, error: null }),
    from: () => {
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'is', 'gte', 'order', 'or', 'in', 'update', 'eq']) b[m] = () => b;
      b.limit = async () => ({ data: [], error: null });
      return b;
    },
  }),
}));

const chiama = async () => {
  const { GET } = await import('@/app/api/cron/send-push/route');
  return (GET as (r: unknown) => Promise<Response>)({ url: 'http://x/api/cron/send-push', headers: new Headers() });
};

describe('R28-006 — senza chiavi delle notifiche il giro non conta come vivo', () => {
  it('senza chiavi: risponde 200 ma segnato come giro non avvenuto', async () => {
    configurato = false;
    const r = await chiama();
    expect(r.status).toBe(200);
    expect((await r.json()).skipped).toBe('VAPID non configurato');
    expect(giroNonFatto(r)).toBe(true);
  });

  it('controprova: con le chiavi il giro è un giro vero e il battito si scrive', async () => {
    configurato = true;
    const r = await chiama();
    expect(giroNonFatto(r)).toBe(false);
  });
});
