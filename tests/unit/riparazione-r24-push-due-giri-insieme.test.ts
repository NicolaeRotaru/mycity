import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Il giro delle notifiche push (app/api/cron/send-push) leggeva le righe con `pushed_at` vuoto e le
 * segnava solo dopo l'invio: due giri sovrapposti (il ritentativo di Vercel, una chiamata a mano)
 * leggevano le stesse righe e mandavano la stessa push due volte.
 *
 * Il database finto tiene le notifiche in memoria e applica ogni scrittura in un passo solo, con i
 * suoi filtri (`in`, `is`, `eq`), come Postgres: un aggiornamento condizionato lo vince uno solo.
 * L'invio è lento (un giro di rete), così i due giri leggono entrambi prima che l'altro scriva.
 */
type Riga = Record<string, unknown>;
const stato = vi.hoisted(() => ({
  notifiche: [] as Array<Record<string, unknown>>,
  inviate: [] as string[],
  esitoInvio: { delivered: 1, total: 1 },
}));

vi.mock('@/lib/api/middleware', () => ({ withCronAuth: (h: (r: unknown) => unknown) => (r: unknown) => h(r) }));
vi.mock('@/lib/cron/fermo-dei-lavori', () => ({
  chiamataDelCalendarioFerma: () => false, rispostaDelFermo: () => null, segnaGiroNonFatto: (r: unknown) => r,
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/push/send', () => ({
  isPushConfigured: () => true,
  iscrizioniPerUtenti: async (_s: unknown, ids: string[]) => new Map(ids.map((u) => [u, [{ id: `s-${u}` }]])),
  sendPushToUser: async (_s: unknown, _u: string, payload: { tag?: string }) => {
    await new Promise((r) => setTimeout(r, 5));
    stato.inviate.push(String(payload.tag));
    return { ...stato.esitoInvio };
  },
}));

function tabellaNotifiche() {
  const filtri: Array<(r: Riga) => boolean> = [];
  let valori: Riga | null = null;
  let ordine: string | null = null;
  let tetto = Infinity;
  const q: Record<string, unknown> = {
    select: () => q,
    update: (v: Riga) => { valori = v; return q; },
    is: (c: string, v: unknown) => { filtri.push((r) => (r[c] ?? null) === v); return q; },
    eq: (c: string, v: unknown) => { filtri.push((r) => r[c] === v); return q; },
    in: (c: string, vs: unknown[]) => { filtri.push((r) => vs.includes(r[c])); return q; },
    gte: (c: string, v: string) => { filtri.push((r) => String(r[c]) >= v); return q; },
    or: () => q,
    order: (c: string) => { ordine = c; return q; },
    limit: (n: number) => { tetto = n; return q; },
    then: (ok: (v: unknown) => unknown) => {
      // Lettura e scrittura in un passo solo: nessun altro giro si infila in mezzo.
      let righe = stato.notifiche.filter((r) => filtri.every((f) => f(r)));
      if (ordine) righe = [...righe].sort((a, b) => String(a[ordine!]).localeCompare(String(b[ordine!])));
      righe = righe.slice(0, tetto);
      if (valori) for (const r of righe) Object.assign(r, valori);
      return Promise.resolve({ data: righe.map((r) => ({ ...r })), error: null }).then(ok);
    },
  };
  return q;
}

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (t: string) => {
      if (t !== 'notifications') throw new Error(`tabella ${t} non prevista`);
      return tabellaNotifiche();
    },
    rpc: async () => ({ data: true, error: null }),
  }),
}));

import { GET } from '@/app/api/cron/send-push/route';

const ora = Date.UTC(2026, 10, 26, 18, 0, 0);
const giro = () => (GET as unknown as (r: Request) => Promise<Response>)(new Request('http://x/api/cron/send-push'));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ora);
  stato.notifiche = [
    { id: 'n1', user_id: 'negozio', title: 'Nuovo ordine', body: null, link: '/seller/orders/ord-1', category: 'order',
      pushed_at: null, created_at: new Date(ora - 2 * 60_000).toISOString() },
    { id: 'n2', user_id: 'cliente', title: 'In consegna', body: null, link: '/orders/ord-2', category: 'order',
      pushed_at: null, created_at: new Date(ora - 60_000).toISOString() },
  ];
  stato.inviate = [];
  stato.esitoInvio = { delivered: 1, total: 1 };
});
afterEach(() => vi.useRealTimers());

describe('giro delle push · due giri sovrapposti non mandano due volte', () => {
  it('due giri lanciati insieme: ogni notifica parte una volta sola', async () => {
    const [a, b] = await Promise.all([giro(), giro()]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect([...stato.inviate].sort()).toEqual(['/orders/ord-2', '/seller/orders/ord-1']);
    expect(stato.notifiche.every((n) => n.pushed_at !== null)).toBe(true);
  });

  it('una push non arrivata torna con pushed_at vuoto, e il giro dopo la riprova', async () => {
    stato.esitoInvio = { delivered: 0, total: 1 };
    await giro();
    expect(stato.notifiche.map((n) => n.pushed_at)).toEqual([null, null]);
    stato.esitoInvio = { delivered: 1, total: 1 };
    stato.inviate = [];
    await giro();
    expect([...stato.inviate].sort()).toEqual(['/orders/ord-2', '/seller/orders/ord-1']);
  });
});
