import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R26-003 — la notifica del nuovo ordine non fa la fila dietro le promozioni.
 * Il finto database tiene le notifiche in memoria e sa fare quello che la lettura chiede
 * (non inviate, ordine di arrivo, tetto, e «senza le categorie che aspettano» con `or`).
 */
const inviate: string[] = [];
let tutte: Array<Record<string, unknown>> = [];
const segnate: string[] = [];

vi.mock('@/lib/api/middleware', () => ({ withCronAuth: (h: (req: unknown) => unknown) => (req: unknown) => h(req) }));
vi.mock('@/lib/push/send', () => ({
  isPushConfigured: () => true,
  iscrizioniPerUtenti: async (_s: unknown, ids: string[]) => new Map(ids.map((u) => [u, [{ id: `s-${u}` }]])),
  sendPushToUser: async (_s: unknown, userId: string, payload: { tag?: string }) => {
    inviate.push(payload.tag ?? userId);
    return { delivered: 1, total: 1 };
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    rpc: async () => ({ data: true, error: null }),
    from: (tabella: string) => {
      const b: Record<string, unknown> = { _update: false, _senzaAttese: false };
      const sel = () => b;
      Object.assign(b, {
        select: sel, is: sel, gte: sel, order: sel,
        or: (s: string) => { b._senzaAttese = s.includes('not.in'); return b; },
        limit: async (n: number) => {
          const righe = tutte.filter((r) => !b._senzaAttese || !['promo', 'group', 'newsletter'].includes(String(r.category)));
          return { data: righe.slice(0, n), error: null };
        },
        update: () => ((b._update = true), b),
        in: (_c: string, valori: string[]) => {
          // La presa del giro (`.is().select()`) ridà le righe prese e la restituzione (`.eq()`) non segna:
          // segna solo la scrittura finale, attesa da sola.
          if (b._update) {
            const scrittura = {
              is: () => scrittura,
              select: async () => ({ data: tutte.filter((r) => valori.includes(r.id as string)), error: null }),
              eq: async () => ({ error: null }),
              then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
                segnate.push(...valori);
                return Promise.resolve({ error: null }).then(ok, ko);
              },
            };
            return scrittura;
          }
          if (tabella === 'push_subscriptions') return Promise.resolve({ data: valori.map((u) => ({ id: `s-${u}`, user_id: u, endpoint: 'e', p256dh: 'p', auth: 'a' })), error: null });
          return Promise.resolve({ data: [], error: null });
        },
      });
      return b;
    },
  }),
}));

async function giro() {
  const { POST } = await import('@/app/api/cron/send-push/route');
  return (POST as unknown as (req: Request) => Promise<Response>)(new Request('http://x', { method: 'POST' }));
}

beforeEach(() => { inviate.length = 0; segnate.length = 0; tutte = []; });

describe('R26-003 push: l ordine prima delle promozioni', () => {
  it('cento promozioni più vecchie non tengono fuori il nuovo ordine', async () => {
    tutte = Array.from({ length: 100 }, (_, i) => ({ id: `p${i}`, user_id: `u${i}`, title: 'Sconto', body: null, link: null, category: 'promo' }));
    tutte.push({ id: 'o1', user_id: 'cliente', title: 'Nuovo ordine', body: null, link: '/orders/3f9a12bc-1111-4222-8333-444455556666', category: 'order' });
    const r = await giro();
    expect(r.status).toBe(200);
    expect(segnate).toContain('o1');
  });

  it('con poche notifiche la lettura resta una sola e tutte partono', async () => {
    tutte = [
      { id: 'p1', user_id: 'u1', title: 'Sconto', body: null, link: null, category: 'promo' },
      { id: 'o1', user_id: 'u1', title: 'Pronto', body: null, link: '/orders/3f9a12bc-1111-4222-8333-444455556666', category: 'order' },
    ];
    await giro();
    expect([...segnate].sort()).toEqual(['o1', 'p1']);
  });
});
