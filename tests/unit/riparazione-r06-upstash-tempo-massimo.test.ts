/**
 * R06-001 — Il sorvegliante legge il conto degli errori da Upstash: se Upstash non risponde mai, il
 * giro non resta appeso fino al tempo massimo della funzione, ma si arrende e dice che il controllo
 * è saltato. Fetch finto che non risponde (si arrende solo se riceve il segnale) e orologio finto.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

const finti = vi.hoisted(() => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  campanelle: [] as Array<Record<string, unknown>>,
  memoria: new Map<string, string>(),
}));
vi.mock('@sentry/nextjs', () => ({ captureException: finti.captureException, captureMessage: finti.captureMessage }));
vi.mock('@/lib/analytics/sentry', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/api/middleware', () => ({ withCronAuth: (g: (r: unknown) => unknown) => (r: unknown) => g(r) }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true, id: 'x' })) }));

/** Un database finto che risponde «niente da segnalare» e tiene la memoria degli allarmi. */
type Chiamata = { m: string; a: unknown[] };
type Riga = { alert_key: string; last_sent_at: string };

/**
 * La memoria degli allarmi (`operational_alert_log`: chiave → ultimo invio) con le regole del
 * database che il sorvegliante usa: leggere le chiavi inviate da una certa ora in poi, prendere il
 * turno (rinfrescare le vecchie, inserire le nuove: una chiave già scritta dà 23505), restituirlo,
 * riscrivere l'attesa dopo l'invio.
 */
function memoriaDegliAllarmi(chiamate: Chiamata[]): { data: unknown; error: unknown } {
  const argomenti = (m: string) => chiamate.find((x) => x.m === m)?.a;
  const chiavi = (argomenti('in')?.[1] as string[] | undefined) ?? [];
  const memoria = finti.memoria;
  const upsert = argomenti('upsert');
  if (upsert) {
    for (const r of ([] as Riga[]).concat(upsert[0] as Riga | Riga[])) memoria.set(r.alert_key, r.last_sent_at);
    return { data: null, error: null };
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
  const daQuando = argomenti('gte')?.[1] as string | undefined;
  return { data: chiavi.filter((k) => memoria.has(k) && (!daQuando || memoria.get(k)! >= daQuando)).map((k) => ({ alert_key: k })), error: null };
}

function tabella(nome: string): unknown {
  const chiamate: Chiamata[] = [];
  const c: unknown = new Proxy({}, {
    get(_b, k) {
      if (k === 'then') {
        const su = (m: string) => chiamate.some((x) => x.m === m);
        let esito: { data: unknown; error: unknown } = { data: [], error: null };
        if (nome === 'notifications' && su('insert')) {
          finti.campanelle.push(...([] as Array<Record<string, unknown>>).concat(chiamate.find((x) => x.m === 'insert')!.a[0] as never));
          esito = { data: null, error: null };
        } else if (nome === 'operational_alert_log') {
          esito = memoriaDegliAllarmi(chiamate);
        } else if (nome === 'profiles' && chiamate.some((x) => x.m === 'eq' && x.a[1] === 'admin')) {
          esito = { data: [{ id: 'admin-1' }], error: null };
        } else if (nome === 'categories') {
          esito = { data: [{ id: 'cat-1' }], error: null };
        }
        const p = Promise.resolve(esito);
        return p.then.bind(p);
      }
      if (typeof k === 'symbol') return undefined;
      return (...a: unknown[]) => { chiamate.push({ m: String(k), a }); return c; };
    },
  });
  return c;
}
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => ({ from: (t: string) => tabella(t) }) }));

import { POST as sorvegliante } from '@/app/api/cron/operational-alerts/route';

const UPSTASH = 'https://upstash-finto.test';
const salvato = { ...process.env };

beforeEach(() => {
  for (const v of ['NEXT_PUBLIC_SENTRY_DSN', 'SENTRY_DSN', 'VERCEL_ENV']) delete process.env[v];
  process.env.SUPPORT_EMAIL = 'nicola@mycity.test';
  process.env.LAVORI_A_ORARIO = 'accesi';
  process.env.UPSTASH_REDIS_REST_URL = UPSTASH;
  process.env.UPSTASH_REDIS_REST_TOKEN = 'gettone-finto';
  finti.campanelle = [];
  finti.memoria.clear();
  // Upstash non risponde mai: la promessa si chiude solo se qualcuno la interrompe col segnale.
  vi.stubGlobal('fetch', vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_ok, ko) => {
    init?.signal?.addEventListener('abort', () => ko(new DOMException('interrotta', 'AbortError')));
  })));
  for (const k of ['log', 'warn', 'error'] as const) vi.spyOn(console, k).mockImplementation(() => {});
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-21T10:20:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  process.env = { ...salvato };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('R06-001 · il sorvegliante non aspetta Upstash per sempre', () => {
  it('con Upstash muto il giro finisce entro il tempo massimo e dice che il conto degli errori non è stato letto', async () => {
    let finito = false;
    const giro = sorvegliante({ url: 'http://localhost/api/cron/operational-alerts', headers: new Headers() } as unknown as NextRequest)
      .then(async (res) => { finito = true; return (await res.json()) as { controlliSaltati?: string[] }; });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(finito, 'il giro è ancora appeso ad aspettare Upstash').toBe(true);
    expect((await giro).controlliSaltati ?? []).toContain('conto degli errori del sito');
  });
});
