/**
 * R13-004 — L'allarme del tetto di spesa AI scattava solo se la stessa copia del sito restava accesa
 * per un'ora: l'ora di tolleranza viveva nella memoria della copia, e su Vercel le copie vivono poco.
 * La funzione che ricorda l'inizio del guasto nel database (allarmiTettoSpesaAiPerIlCron, riga
 * «ai-tetto-condiviso:ripiego-da» di operational_alert_log) c'era, ma il sorvegliante non la chiamava.
 *
 * Qui il sorvegliante vero, con un database finto che tiene la memoria degli allarmi e un conto
 * condiviso che non risponde. Ogni giro parte da una copia nuova (memoria della copia azzerata):
 * il primo giro ricorda l'inizio del guasto nel database, il giro di due ore dopo suona.
 * Senza tetto configurato il giro non sonda e non scrive niente.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

const finti = vi.hoisted(() => ({
  memoria: new Map<string, string>(),
  rpc: [] as string[],
  rispostaRpc: { data: null as unknown, error: { code: '57014', message: 'canceling statement due to statement timeout' } as unknown },
}));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock('@/lib/analytics/sentry', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/api/middleware', () => ({ withCronAuth: (g: (r: unknown) => unknown) => (r: unknown) => g(r) }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true, id: 'x' })) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
// Con l'AI dei negozi spenta l'allarme del tetto tace (lib/ai/tettoSpesa.ts): qui la si prova accesa.
vi.mock('@/lib/funzioni-al-lancio', async (originale) => ({ ...((await originale()) as object), AI_NEGOZI_ACCESA: true }));

type Chiamata = { m: string; a: unknown[] };
type Riga = { alert_key: string; last_sent_at: string };

/** operational_alert_log: chiave → ultimo invio, con le regole che usano il sorvegliante e il tetto. */
function memoriaDegliAllarmi(chiamate: Chiamata[]): { data: unknown; error: unknown } {
  const argomenti = (m: string) => chiamate.find((x) => x.m === m)?.a;
  const memoria = finti.memoria;
  const eq = argomenti('eq');
  const chiaveEq = eq && eq[0] === 'alert_key' ? String(eq[1]) : undefined;
  const chiavi = chiaveEq ? [chiaveEq] : ((argomenti('in')?.[1] as string[] | undefined) ?? []);
  const upsert = argomenti('upsert');
  if (upsert) {
    const scritte: string[] = [];
    for (const r of ([] as Riga[]).concat(upsert[0] as Riga | Riga[])) {
      if ((upsert[1] as { ignoreDuplicates?: boolean } | undefined)?.ignoreDuplicates && memoria.has(r.alert_key)) continue;
      memoria.set(r.alert_key, r.last_sent_at);
      scritte.push(r.alert_key);
    }
    return { data: scritte.map((k) => ({ alert_key: k })), error: null };
  }
  const insert = argomenti('insert');
  if (insert) {
    const righe = ([] as Riga[]).concat(insert[0] as Riga | Riga[]);
    if (righe.some((r) => memoria.has(r.alert_key))) return { data: null, error: { code: '23505', message: 'duplicate key' } };
    for (const r of righe) memoria.set(r.alert_key, r.last_sent_at);
    return { data: null, error: null };
  }
  if (argomenti('delete')) {
    for (const k of chiavi) memoria.delete(k);
    return { data: null, error: null };
  }
  const update = argomenti('update');
  if (update) {
    const primaDi = argomenti('lt')![1] as string;
    const prese = chiavi.filter((k) => memoria.has(k) && memoria.get(k)! < primaDi);
    for (const k of prese) memoria.set(k, (update[0] as Riga).last_sent_at);
    return { data: prese.map((k) => ({ alert_key: k })), error: null };
  }
  if (argomenti('maybeSingle')) {
    return { data: chiaveEq && memoria.has(chiaveEq) ? { last_sent_at: memoria.get(chiaveEq) } : null, error: null };
  }
  const daQuando = argomenti('gte')?.[1] as string | undefined;
  return { data: chiavi.filter((k) => memoria.has(k) && (!daQuando || memoria.get(k)! >= daQuando)).map((k) => ({ alert_key: k })), error: null };
}

function tabella(nome: string): unknown {
  const chiamate: Chiamata[] = [];
  const c: unknown = new Proxy({}, {
    get(_b, k) {
      if (k === 'then') {
        let esito: { data: unknown; error: unknown } = { data: [], error: null };
        if (nome === 'operational_alert_log') esito = memoriaDegliAllarmi(chiamate);
        else if (nome === 'notifications' && chiamate.some((x) => x.m === 'insert')) esito = { data: null, error: null };
        else if (nome === 'profiles' && chiamate.some((x) => x.m === 'eq' && x.a[1] === 'admin')) esito = { data: [{ id: 'admin-1' }], error: null };
        else if (nome === 'categories') esito = { data: [{ id: 'cat-1' }], error: null };
        const p = Promise.resolve(esito);
        return p.then.bind(p);
      }
      if (typeof k === 'symbol') return undefined;
      return (...a: unknown[]) => { chiamate.push({ m: String(k), a }); return c; };
    },
  });
  return c;
}
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (t: string) => tabella(t),
    rpc: async (nome: string) => { finti.rpc.push(nome); return finti.rispostaRpc; },
  }),
}));

import { POST as sorvegliante } from '@/app/api/cron/operational-alerts/route';
import { CHIAVE_RIPIEGO_DA, __azzeraRipiegoSpesaAi } from '@/lib/ai/tettoSpesa';
import { TIPO_ALLARME_TETTO_AI } from '@/lib/ai/decisioneTettoSpesa';

const salvato = { ...process.env };

beforeEach(() => {
  for (const v of ['NEXT_PUBLIC_SENTRY_DSN', 'SENTRY_DSN', 'VERCEL_ENV', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'AI_GLOBAL_DAILY_BUDGET_EUR', 'AI_COPIE_ATTESE']) delete process.env[v];
  process.env.SUPPORT_EMAIL = 'nicola@mycity.test';
  process.env.LAVORI_A_ORARIO = 'accesi';
  finti.memoria.clear();
  finti.rpc.length = 0;
  finti.rispostaRpc = { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };
  __azzeraRipiegoSpesaAi();
  vi.stubGlobal('fetch', vi.fn(async (u: unknown) => { throw new Error(`rete vera chiesta: ${String(u)}`); }));
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-22T10:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  process.env = { ...salvato };
  vi.unstubAllGlobals();
});

async function giro() {
  const res = await sorvegliante({ url: 'http://localhost/api/cron/operational-alerts', headers: new Headers() } as unknown as NextRequest);
  return (await res.json()) as { details?: Array<{ type: string; detail: string }> };
}
const tipi = (corpo: { details?: Array<{ type: string }> }) => (corpo.details ?? []).map((d) => d.type);

describe('il sorvegliante chiama l allarme del tetto di spesa AI', () => {
  it('primo giro: il guasto del conto condiviso si ricorda nel database, fuori dalla copia', async () => {
    process.env.AI_GLOBAL_DAILY_BUDGET_EUR = '20';
    const corpo = await giro();
    expect(finti.rpc).toContain('spesa_ai_di_oggi');
    expect(finti.memoria.get(CHIAVE_RIPIEGO_DA), 'l inizio del guasto non e ricordato da nessuna parte').toBe('2026-11-22T10:00:00.000Z');
    expect(tipi(corpo)).not.toContain(TIPO_ALLARME_TETTO_AI);
  });

  it('due ore dopo, su una copia nuova, il giro suona', async () => {
    process.env.AI_GLOBAL_DAILY_BUDGET_EUR = '20';
    await giro();
    __azzeraRipiegoSpesaAi(); // la copia di prima non c'e' piu'
    vi.setSystemTime(new Date('2026-11-22T12:00:00Z'));
    const corpo = await giro();
    expect(tipi(corpo), `il tetto non suona: ${JSON.stringify(corpo)}`).toContain(TIPO_ALLARME_TETTO_AI);
    const riga = corpo.details!.find((d) => d.type === TIPO_ALLARME_TETTO_AI)!.detail;
    expect(riga).toMatch(/non risponde da 120 min/);
    expect(finti.memoria.get(CHIAVE_RIPIEGO_DA), 'l inizio del guasto si e spostato').toBe('2026-11-22T10:00:00.000Z');
  });

  it('quando il conto torna a rispondere, la riga del guasto si toglie', async () => {
    process.env.AI_GLOBAL_DAILY_BUDGET_EUR = '20';
    finti.memoria.set(CHIAVE_RIPIEGO_DA, '2026-11-22T06:00:00.000Z');
    finti.rispostaRpc = { data: 150, error: null };
    const corpo = await giro();
    expect(finti.memoria.has(CHIAVE_RIPIEGO_DA)).toBe(false);
    expect(tipi(corpo)).not.toContain(TIPO_ALLARME_TETTO_AI);
  });

  it('senza tetto configurato il giro non sonda il conto e non scrive righe del tetto', async () => {
    const corpo = await giro();
    expect(finti.rpc).not.toContain('spesa_ai_di_oggi');
    expect(finti.memoria.has(CHIAVE_RIPIEGO_DA)).toBe(false);
    expect(tipi(corpo)).not.toContain(TIPO_ALLARME_TETTO_AI);
  });
});
