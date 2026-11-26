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
/**
 * 26/11/2026 — Il giro prende le notifiche prima di mandarle (`pushed_at` all'ora della presa, solo
 * dove è vuoto) e alla fine ridà vuote quelle non mandate. `segnate` quindi è lo stato finale: le righe
 * che restano con `pushed_at` pieno. Il database finto conferma le righe toccate.
 */
function scritturaSuPushedAt(valore: string | null, ids: string[]) {
  if (valore !== null) {
    for (const id of ids) if (!segnate.includes(id)) segnate.push(id);
  } else {
    for (const id of ids) {
      const k = segnate.indexOf(id);
      if (k >= 0) segnate.splice(k, 1);
    }
  }
  const esito = { data: ids.map((id) => ({ id })), error: null };
  const c: Record<string, unknown> = {
    is: () => c, eq: () => c, select: () => c,
    then: (ok: (v: unknown) => unknown) => Promise.resolve(esito).then(ok),
  };
  return c;
}

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
        update: (v: { pushed_at?: string | null }) => ((b._update = true), (b._valore = v.pushed_at ?? null), b),
        in: (_c: string, valori: string[]) => {
          if (b._update) return scritturaSuPushedAt(b._valore as string | null, valori);
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
