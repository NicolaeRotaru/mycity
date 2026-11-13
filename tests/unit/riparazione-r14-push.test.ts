import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * R14-016 — la notifica del nuovo ordine non fa la fila dietro le promozioni
 * (app/api/cron/send-push/route.ts).
 *
 * Il caso: un ribasso su un prodotto preferito da trecento persone scrive trecento righe «promo»
 * tutte insieme; un minuto dopo arriva il «Nuovo ordine» della panetteria. Il giro prende cento
 * notifiche: se prende le cento più vecchie, sono tutte promozioni e il nuovo ordine aspetta.
 *
 * Il finto database applica davvero in, is, gte, order e limit alle notifiche.
 */

type Riga = Record<string, unknown>;
let notifiche: Riga[] = [];
const mandate: Array<{ user: string; title: string }> = [];

function tabella() {
  const filtri: Array<(r: Riga) => boolean> = [];
  let ordine: { col: string; asc: boolean } | null = null;
  let limite: number | null = null;
  let modifica: Riga | null = null;
  const b: Record<string, unknown> = {
    select: () => b,
    update: (v: Riga) => { modifica = v; return b; },
    in: (c: string, v: unknown[]) => { filtri.push((r) => v.includes(r[c])); return b; },
    is: (c: string, v: unknown) => { filtri.push((r) => (v === null ? r[c] == null : r[c] === v)); return b; },
    gte: (c: string, v: string) => { filtri.push((r) => String(r[c]) >= v); return b; },
    order: (col: string, o?: { ascending?: boolean }) => { ordine = { col, asc: o?.ascending !== false }; return b; },
    limit: (n: number) => { limite = n; return b; },
    then: (ok: (v: unknown) => unknown) => {
      let righe = notifiche.filter((r) => filtri.every((f) => f(r)));
      if (modifica) {
        for (const r of righe) Object.assign(r, modifica);
        return Promise.resolve({ data: null, error: null }).then(ok);
      }
      if (ordine) {
        const { col, asc } = ordine;
        righe = [...righe].sort((x, y) => (String(x[col]) < String(y[col]) ? -1 : String(x[col]) > String(y[col]) ? 1 : 0) * (asc ? 1 : -1));
      }
      if (limite !== null) righe = righe.slice(0, limite);
      return Promise.resolve({ data: righe.map((r) => ({ ...r })), error: null }).then(ok);
    },
  };
  return b;
}

vi.mock('@/lib/api/middleware', () => ({ withCronAuth: (h: (req: unknown) => unknown) => (req: unknown) => h(req) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: () => tabella(),
    rpc: async () => ({ data: true, error: null }),
  }),
}));
vi.mock('@/lib/push/send', () => ({
  isPushConfigured: () => true,
  iscrizioniPerUtenti: async (_s: unknown, utenti: string[]) => new Map(utenti.map((u) => [u, [{ id: `s-${u}` }]])),
  sendPushToUser: async (_s: unknown, user: string, msg: { title: string }) => {
    mandate.push({ user, title: msg.title });
    return { delivered: 1, total: 1 };
  },
}));

async function giro() {
  const { GET } = await import('@/app/api/cron/send-push/route');
  const res = await (GET as unknown as (req: Request) => Promise<Response>)(new Request('http://x'));
  return (await res.json()) as { sent: number; processed: number };
}

/** Lunedì 16 novembre 2026, 11:00 a Piacenza. */
const ADESSO = new Date('2026-11-16T10:00:00.000Z');
const minutiFa = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ADESSO);
  mandate.length = 0;
  // Trecento «Prezzo abbassato» nati dieci minuti fa, uno al secondo.
  notifiche = Array.from({ length: 300 }, (_, i) => ({
    id: `promo-${i}`, user_id: `cliente-${i}`, title: 'Prezzo abbassato', body: null, link: '/p/pane',
    category: 'promo', pushed_at: null, created_at: new Date(Date.parse(minutiFa(10)) + i * 1_000).toISOString(),
  }));
  notifiche.push({
    id: 'ordine-1', user_id: 'negozio-1', title: 'Nuovo ordine', body: 'Ordine #A1B2C3', link: '/seller/orders/abc1',
    category: 'order', pushed_at: null, created_at: minutiFa(1),
  });
});
afterEach(() => { vi.useRealTimers(); });

describe('R14-016 — prima ordini e avvisi di servizio, poi le promozioni', () => {
  it('il nuovo ordine parte al primo giro anche dietro trecento promozioni', async () => {
    const esito = await giro();
    expect(mandate.map((m) => m.title), 'il nuovo ordine fa la fila dietro le promozioni').toContain('Nuovo ordine');
    expect(notifiche.find((n) => n.id === 'ordine-1')?.pushed_at).not.toBeNull();
    // Il lotto resta di cento: il resto delle promozioni va ai giri dopo, dalle più vecchie.
    expect(esito.processed).toBe(100);
    expect(mandate.filter((m) => m.title === 'Prezzo abbassato')).toHaveLength(99);
    expect(notifiche.find((n) => n.id === 'promo-0')?.pushed_at).not.toBeNull();
    expect(notifiche.find((n) => n.id === 'promo-150')?.pushed_at).toBeNull();
  });

  it('anche l avviso di servizio passa davanti', async () => {
    notifiche.push({
      id: 'sistema-1', user_id: 'admin-1', title: '⚠️ 1 alert operativi', body: null, link: '/admin/today',
      category: 'system', pushed_at: null, created_at: minutiFa(2),
    });
    await giro();
    expect(mandate.map((m) => m.title)).toContain('⚠️ 1 alert operativi');
  });

  it('senza urgenze il lotto si riempie con le altre, ognuna una volta sola', async () => {
    notifiche = notifiche.filter((n) => n.category === 'promo').slice(0, 30);
    const esito = await giro();
    expect(esito.processed).toBe(30);
    expect(new Set(mandate.map((m) => m.user)).size).toBe(30);
    expect(mandate).toHaveLength(30);
  });
});
