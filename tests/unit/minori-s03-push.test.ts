import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * S03 — il giro delle push (schede 550, 112, 41, 321).
 * La lettura delle notifiche, delle preferenze o delle iscrizioni che cade non diventa mai
 * «tutto mandato»; il contrassegno del telefono è il link solo se il link porta un id.
 */

const inviate: Array<{ userId: string; tag?: string; iscrizioni: unknown }> = [];
let erroreIscrizioni = false;
vi.mock('@/lib/api/middleware', () => ({ withCronAuth: (h: (req: unknown) => unknown) => (req: unknown) => h(req) }));
vi.mock('@/lib/push/send', async (orig) => {
  const vero = await orig<typeof import('@/lib/push/send')>();
  return {
    isPushConfigured: () => true,
    // La lettura delle iscrizioni è quella vera: risponde il finto database qui sotto.
    iscrizioniPerUtenti: vero.iscrizioniPerUtenti,
    sendPushToUser: async (_s: unknown, userId: string, payload: { tag?: string }, iscrizioni: unknown) => {
      inviate.push({ userId, tag: payload.tag, iscrizioni });
      return { delivered: 1, total: 1 };
    },
  };
});

import { segnateIn, tabellaNotifiche, type RigaNotifica } from './aiuti/finte-notifiche-push';

/** Le notifiche rimaste segnate alla fine del giro (R03-016: il giro le prende e ridà le non partite). */
const segnate: string[] = [];
let pending: Array<Record<string, unknown>> = [];
let erroreLettura = false;
let rpcErrore = false;

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    rpc: async () => (rpcErrore ? { data: null, error: { message: 'timeout' } } : { data: true, error: null }),
    from: (tabella: string) => {
      if (tabella === 'notifications') {
        return tabellaNotifiche(() => pending as RigaNotifica[], {
          erroreLettura: () => (erroreLettura ? { message: 'permission denied' } : null),
        });
      }
      const b: Record<string, unknown> = {};
      const sel = () => b;
      Object.assign(b, {
        select: sel,
        in: async (_c: string, valori: string[]) => {
          if (tabella === 'push_subscriptions') {
            return erroreIscrizioni
              ? { data: null, error: { message: 'canceling statement due to statement timeout' } }
              : { data: valori.map((u) => ({ id: `s-${u}`, user_id: u, endpoint: 'e', p256dh: 'p', auth: 'a' })), error: null };
          }
          return { data: [], error: null };
        },
      });
      return b;
    },
  }),
}));

async function giro() {
  const { POST } = await import('@/app/api/cron/send-push/route');
  const r = await (POST as unknown as (req: Request) => Promise<Response>)(new Request('http://x', { method: 'POST' }));
  segnate.length = 0;
  segnate.push(...segnateIn(pending as RigaNotifica[]));
  return r;
}

const ORDINE = '/orders/3f9a12bc-1111-4222-8333-444455556666';
beforeEach(() => {
  inviate.length = 0; segnate.length = 0; pending = [];
  erroreLettura = false; rpcErrore = false; erroreIscrizioni = false;
});

describe('giro delle push', () => {
  it('550 — la lettura delle notifiche che cade risponde 503, non «0 inviate»', async () => {
    erroreLettura = true;
    const r = await giro();
    expect(r.status).toBe(503);
  });

  it('112 — preferenza non letta: la promozione resta in coda, l ordine parte', async () => {
    rpcErrore = true;
    pending = [
      { id: 'p1', user_id: 'u1', title: 'Sconto', body: null, link: null, category: 'promo' },
      { id: 'o1', user_id: 'u1', title: 'Pronto', body: null, link: ORDINE, category: 'order' },
    ];
    await giro();
    expect(inviate.map((x) => x.userId)).toEqual(['u1']);
    expect(segnate).toEqual(['o1']);
  });

  it('41 — iscrizioni non lette: niente segnato come mandato', async () => {
    erroreIscrizioni = true;
    pending = [{ id: 'o1', user_id: 'u1', title: 'Pronto', body: null, link: ORDINE, category: 'order' }];
    const r = await giro();
    expect(r.status).toBe(200);
    expect(segnate).toEqual([]);
    expect(inviate).toEqual([]);
  });

  it('321 — i link di sezione non fanno da contrassegno; quelli con un id sì', async () => {
    pending = [
      { id: 'r1', user_id: 'rider', title: 'Ordine pronto', body: null, link: '/rider', category: 'order' },
      { id: 'r2', user_id: 'rider', title: 'SOS', body: null, link: '/admin/sos', category: 'system' },
      { id: 'o1', user_id: 'u1', title: 'Pronto', body: null, link: ORDINE, category: 'order' },
    ];
    await giro();
    expect(inviate.map((x) => x.tag)).toEqual(['r1', 'r2', ORDINE]);
  });
});
