import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Il giro dei carrelli scaduti (app/api/cron/expire-checkouts) restituisce il codice sconto
 * (`release_coupon`) ma deve anche chiudere la rivendicazione di quel tentativo
 * (`coupon_redemptions.released_at`), come fa già il webhook `checkout.session.expired`.
 * Altrimenti il contatore torna giù ma il codice di benvenuto resta bloccato per il cliente.
 *
 * Supabase finto: filtra davvero per `eq` / `in` / `lt` / `is`, `update` scrive sulle righe trovate.
 */
type Riga = Record<string, unknown>;
const db = vi.hoisted(() => ({
  carrelli: [] as Riga[],
  ordini: [] as Riga[],
  rivendicazioni: [] as Riga[],
  rpc: [] as Array<{ nome: string; args: unknown }>,
  rpcFallisce: new Set<string>(),
}));

function query(tabella: string) {
  let righe: Riga[] =
    tabella === 'pending_checkouts' ? db.carrelli
    : tabella === 'orders' ? db.ordini
    : tabella === 'coupon_redemptions' ? db.rivendicazioni
    : [];
  let aggiorna: Riga | null = null;
  const q: Record<string, unknown> = {
    select: () => q,
    update: (v: Riga) => { aggiorna = v; return q; },
    upsert: () => Promise.resolve({ error: null }),
    insert: () => Promise.resolve({ error: null }),
    eq: (c: string, v: unknown) => { righe = righe.filter((r) => r[c] === v); return q; },
    in: (c: string, v: unknown[]) => { righe = righe.filter((r) => v.includes(r[c])); return q; },
    is: (c: string, v: unknown) => { righe = righe.filter((r) => (r[c] ?? null) === v); return q; },
    lt: (c: string, v: string) => { righe = righe.filter((r) => String(r[c]) < v); return q; },
    gte: () => q,
    order: (c: string, o?: { ascending?: boolean }) => {
      righe = [...righe].sort((a, b) => String(a[c]).localeCompare(String(b[c])) * (o?.ascending === false ? -1 : 1));
      return q;
    },
    limit: (n: number) => { righe = righe.slice(0, n); return q; },
    then: (ok: (v: unknown) => unknown) => {
      if (aggiorna) for (const r of righe) Object.assign(r, aggiorna);
      return ok({ data: righe, error: null });
    },
  };
  return q;
}

vi.mock('@/lib/api/middleware', () => ({ withCronAuth: (h: (r: unknown) => unknown) => (r: unknown) => h(r) }));
vi.mock('@/lib/cron/fermo-dei-lavori', () => ({ chiamataDelCalendarioFerma: () => false, rispostaDelFermo: () => null }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: vi.fn(async () => undefined) }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (t: string) => (t === 'profiles' ? { select: () => ({ eq: async () => ({ data: [{ id: 'a1' }], error: null }) }) } : query(t)),
    rpc: (nome: string, args: unknown) => {
      db.rpc.push({ nome, args });
      return Promise.resolve({ data: null, error: db.rpcFallisce.has(nome) ? { message: 'rifiutata' } : null });
    },
  }),
}));

import { POST } from '@/app/api/cron/expire-checkouts/route';

const ora = Date.UTC(2026, 10, 26, 3, 0, 0);
const isoFa = (minuti: number) => new Date(ora - minuti * 60_000).toISOString();
const giro = () =>
  (POST as unknown as (r: Request) => Promise<Response>)(new Request('http://x/api/cron/expire-checkouts', { method: 'POST' }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ora);
  db.carrelli = [
    {
      id: 'pc-1', status: 'PENDING', expires_at: isoFa(30), stripe_session_id: 'cs_1', coupon_code: 'BENVENUTO',
      groups: [{ items: [{ productId: 'p1', quantity: 1 }] }],
      delivery: { rivendicazione: 'red-mia' },
    },
  ];
  db.ordini = [];
  db.rivendicazioni = [
    { id: 'red-mia', code: 'BENVENUTO', released_at: null },
    // La rivendicazione di un'altra scheda dello stesso cliente: non si tocca.
    { id: 'red-altra', code: 'BENVENUTO', released_at: null },
  ];
  db.rpc = [];
  db.rpcFallisce = new Set();
});
afterEach(() => vi.useRealTimers());

describe('giro notturno dei carrelli scaduti · il codice sconto torna e la sua rivendicazione si chiude', () => {
  it('scaduto il carrello, la rivendicazione scritta nella sua riga di intento ha released_at', async () => {
    const r = await giro();
    expect(r.status).toBe(200);
    expect(db.carrelli[0].status).toBe('EXPIRED');
    expect(db.rpc.map((c) => c.nome)).toContain('release_coupon');
    expect(db.rivendicazioni.find((x) => x.id === 'red-mia')!.released_at).toBe(new Date(ora).toISOString());
    expect(db.rivendicazioni.find((x) => x.id === 'red-altra')!.released_at).toBeNull();
  });

  it('se il codice non torna nel contatore, la rivendicazione resta aperta', async () => {
    db.rpcFallisce.add('release_coupon');
    await giro();
    expect(db.carrelli[0].status).toBe('EXPIRED');
    expect(db.rivendicazioni.every((x) => x.released_at === null)).toBe(true);
  });

  it('un carrello senza rivendicazione scritta non chiude niente', async () => {
    db.carrelli[0].delivery = {};
    await giro();
    expect(db.rpc.map((c) => c.nome)).toContain('release_coupon');
    expect(db.rivendicazioni.every((x) => x.released_at === null)).toBe(true);
  });
});
