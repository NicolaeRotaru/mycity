import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * R22-002 — Alla riaccensione della posta, le email scadute non fanno la fila davanti a quelle nuove.
 *
 * Il giro vero (app/api/cron/send-emails) su una coda in memoria che fa quello che fa la
 * migrazione 165: `claim_pending_emails` prende in ordine di `send_at`, senza guardare `scade_at`,
 * al massimo `p_max` righe. Nessuna email vera: `sendEmail` è finto.
 */

const spedite: string[] = [];
vi.mock('@/lib/api/middleware', () => ({
  withCronAuth: (h: (req: unknown) => unknown) => (req: unknown) => h(req),
}));
vi.mock('@/lib/email/client', () => ({
  sendEmail: async (m: { idempotencyKey?: string; tags?: Array<{ value: string }> }) => {
    spedite.push(String(m.idempotencyKey ?? m.tags?.[0]?.value));
    return { ok: true, id: `msg-${spedite.length}` };
  },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {}, spesa: () => {} } }));

type Riga = {
  id: string; user_id: string; template: string; attempts: number; metadata: null;
  send_at: string; scade_at: string | null; created_at: string; last_error: string | null;
  claimed_at: string | null; sent_at: string | null; cancelled_at: string | null;
};
let coda: Riga[] = [];

type Filtro = (r: Record<string, unknown>) => boolean;
const confronta = (v: unknown, x: unknown) => Date.parse(String(v)) - Date.parse(String(x));

/** Un pezzetto di PostgREST: abbastanza per le letture e le scritture del giro su `email_queue`. */
function domanda(tabella: string, valori?: Record<string, unknown>) {
  const filtri: Filtro[] = [];
  const righe = () => (tabella === 'email_queue' ? coda : []) as unknown as Record<string, unknown>[];
  const q = {
    is: (c: string, v: null) => (filtri.push((r) => (r[c] ?? null) === v), q),
    eq: (c: string, v: unknown) => (filtri.push((r) => r[c] === v), q),
    in: (c: string, v: unknown[]) => (filtri.push((r) => v.includes(r[c])), q),
    lt: (c: string, v: unknown) => (filtri.push((r) => r[c] != null && confronta(r[c], v) < 0), q),
    lte: (c: string, v: unknown) => (filtri.push((r) => r[c] != null && confronta(r[c], v) <= 0), q),
    gte: (c: string, v: unknown) => (filtri.push((r) => r[c] != null && confronta(r[c], v) >= 0), q),
    not: () => q,
    select: () => q,
    then: (ok: (x: unknown) => unknown, ko?: (e: unknown) => unknown) => {
      const scelte = righe().filter((r) => filtri.every((f) => f(r)));
      if (valori) for (const r of scelte) Object.assign(r, valori);
      return Promise.resolve({ data: scelte.map((r) => ({ ...r })), error: null, count: scelte.length }).then(ok, ko);
    },
  };
  return q;
}

function finto() {
  return {
    rpc: async (nome: string, args: { p_max: number }) => {
      if (nome !== 'claim_pending_emails') return { data: null, error: null };
      const adesso = Date.now();
      const prese = coda
        .filter((q) => Date.parse(q.send_at) <= adesso && !q.sent_at && !q.cancelled_at && q.attempts < 5
          && (!q.claimed_at || Date.parse(q.claimed_at) < adesso - 15 * 60_000))
        .sort((a, b) => Date.parse(a.send_at) - Date.parse(b.send_at))
        .slice(0, args.p_max);
      for (const q of prese) q.claimed_at = new Date(adesso).toISOString();
      return {
        data: prese.map(({ id, user_id, template, attempts, metadata, scade_at }) => ({ id, user_id, template, attempts, metadata, scade_at })),
        error: null,
      };
    },
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'cliente@example.it' } }, error: null }) } },
    from: (tabella: string) => ({
      select: () => (tabella === 'profiles'
        ? { in: async () => ({ data: [{ id: 'u1', full_name: 'Marco Rossi', email_marketing: true }], error: null }) }
        : domanda(tabella)),
      update: (valori: Record<string, unknown>) => domanda(tabella, valori),
    }),
  };
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => finto() }));

async function giroDellaPosta() {
  vi.resetModules();
  const { POST } = await import('@/app/api/cron/send-emails/route');
  const r = await (POST as unknown as (req: Request) => Promise<Response>)(
    new Request('http://localhost/api/cron/send-emails', { method: 'POST' }),
  );
  return r.json() as Promise<Record<string, unknown>>;
}

const ORA = Date.parse('2026-11-13T09:00:00Z');
const MINUTO = 60_000;
const GIORNO = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

function riga(id: string, template: string, sendAt: number, scadeAt: number, extra: Partial<Riga> = {}): Riga {
  return {
    id, user_id: 'u1', template, attempts: 0, metadata: null,
    send_at: iso(sendAt), scade_at: iso(scadeAt), created_at: iso(sendAt), last_error: null,
    claimed_at: null, sent_at: null, cancelled_at: null, ...extra,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(ORA);
  spedite.length = 0;
  // Cento benvenuti fermi da settimane (posta spenta), scaduti; poi l'email fresca di oggi.
  coda = Array.from({ length: 100 }, (_, i) =>
    riga(`vecchia-${i}`, 'welcome', ORA - 20 * GIORNO + i * MINUTO, ORA - 17 * GIORNO + i * MINUTO, { last_error: 'posta non pronta' }));
  coda.push(riga('fresca', 'welcome', ORA - MINUTO, ORA + 3 * GIORNO));
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://mycity.example');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('alla riaccensione le scadute non tengono ferma la posta nuova', () => {
  it('con cento scadute in coda, l\'email fresca parte al primo giro', async () => {
    await giroDellaPosta();
    expect(spedite, 'l\'email fresca aspetta dietro alle scadute').toContain('email-queue/fresca');
  });

  it('le scadute si chiudono tutte col motivo, e nessuna parte', async () => {
    await giroDellaPosta();
    const vecchie = coda.filter((q) => q.id.startsWith('vecchia-'));
    expect(vecchie.every((q) => q.cancelled_at && /scadut/.test(String(q.last_error)))).toBe(true);
    expect(spedite.filter((s) => s.includes('vecchia'))).toHaveLength(0);
  });

  it('controprova: una scaduta prenotata da un giro in corso la lascia a lui', async () => {
    coda[0].claimed_at = iso(ORA - 2 * MINUTO);
    await giroDellaPosta();
    expect(coda[0].cancelled_at).toBeNull();
  });

  it('controprova: una riga non scaduta, più vecchia della fresca, parte prima come sempre', async () => {
    coda.push(riga('in-tempo', 'welcome', ORA - 2 * GIORNO, ORA + GIORNO));
    await giroDellaPosta();
    expect(spedite.slice(0, 2)).toEqual(['email-queue/in-tempo', 'email-queue/fresca']);
  });
});
