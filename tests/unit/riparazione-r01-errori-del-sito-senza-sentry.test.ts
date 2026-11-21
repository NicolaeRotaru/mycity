/**
 * R01-005 — Il giorno del lancio un errore del sito non lo vedeva nessuno: il registratore degli
 * errori (Sentry) resta spento per scelta, e l'unico allarme possibile dipendeva dalla chiave che
 * manca. Adesso il logger conta ogni errore del server (solo il numero) nello stesso Upstash del
 * freno anti-abuso, e il sorvegliante lo dice in campanella e per email con ERRORI_DEL_SITO, senza
 * nessuna chiave di Sentry. Qui un Upstash finto in memoria, il logger vero e il sorvegliante vero.
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

import { logger } from '@/lib/logger';
import { GET as salute } from '@/app/api/health/route';
import { POST as sorvegliante } from '@/app/api/cron/operational-alerts/route';
import { sendEmail } from '@/lib/email/client';

const UPSTASH = 'https://upstash-finto.test';
const salvato = { ...process.env };

/** Upstash finto: INCR, EXPIRE e GET in memoria, sulla stessa strada /pipeline del sito. */
const redis = new Map<string, number>();
const chiamateUpstash: unknown[][][] = [];
let upstashGiu = false;
function fetchFinto(url: string | URL, init?: RequestInit): Promise<Response> {
  const indirizzo = String(url);
  if (!indirizzo.startsWith(UPSTASH)) return Promise.reject(new Error(`rete vera chiesta: ${indirizzo}`));
  if (upstashGiu) return Promise.resolve(new Response('giù', { status: 500 }));
  const comandi = JSON.parse(String(init?.body)) as unknown[][];
  chiamateUpstash.push(comandi);
  const risposte = comandi.map(([cmd, chiave]) => {
    const k = String(chiave);
    if (cmd === 'INCR') { redis.set(k, (redis.get(k) ?? 0) + 1); return { result: redis.get(k) }; }
    if (cmd === 'EXPIRE') return { result: 1 };
    if (cmd === 'GET') return { result: redis.has(k) ? String(redis.get(k)) : null };
    return { error: 'comando sconosciuto' };
  });
  return Promise.resolve(new Response(JSON.stringify(risposte), { status: 200 }));
}

beforeEach(() => {
  for (const v of ['NEXT_PUBLIC_SENTRY_DSN', 'SENTRY_DSN', 'VERCEL_ENV', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) delete process.env[v];
  process.env.SUPPORT_EMAIL = 'nicola@mycity.test';
  process.env.LAVORI_A_ORARIO = 'accesi';
  process.env.UPSTASH_REDIS_REST_URL = UPSTASH;
  process.env.UPSTASH_REDIS_REST_TOKEN = 'gettone-finto';
  redis.clear();
  chiamateUpstash.length = 0;
  upstashGiu = false;
  finti.campanelle = [];
  finti.memoria.clear();
  vi.mocked(sendEmail).mockClear();
  vi.stubGlobal('fetch', vi.fn(fetchFinto));
  for (const k of ['log', 'warn', 'error'] as const) vi.spyOn(console, k).mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-21T10:20:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  process.env = { ...salvato };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function giro() {
  const res = await sorvegliante({ url: 'http://localhost/api/cron/operational-alerts', headers: new Headers() } as unknown as NextRequest);
  return { stato: res.status, corpo: (await res.json()) as { details?: Array<{ type: string; detail: string }>; controlliSaltati?: string[] } };
}
const tipi = (corpo: { details?: Array<{ type: string }> }) => (corpo.details ?? []).map((d) => d.type);
const finche = async (condizione: () => boolean) => { for (let i = 0; i < 50 && !condizione(); i++) await Promise.resolve(); };

describe('con Sentry spento, un errore del sito lo vede qualcuno', () => {
  it('un errore del server si conta (solo il numero, nessun testo) e il sorvegliante lo dice in campanella e per email', async () => {
    logger.error(new Error('rimborso fallito per mario.rossi@example.com'), { ordine: 'ord_1' });
    logger.error('webhook Stripe non elaborato', new Error('timeout'));
    await finche(() => [...redis.values()].reduce((a, b) => a + b, 0) >= 2);
    expect([...redis.values()].reduce((a, b) => a + b, 0), 'gli errori del server non si contano da nessuna parte').toBe(2);
    expect(JSON.stringify(chiamateUpstash), 'nel conto è finito il testo dell\'errore').not.toMatch(/mario|rimborso|Stripe/);

    const { corpo } = await giro();
    expect(tipi(corpo), `il sorvegliante tace sugli errori del sito: ${JSON.stringify(corpo)}`).toContain('ERRORI_DEL_SITO');
    const riga = corpo.details!.find((d) => d.type === 'ERRORI_DEL_SITO')!.detail;
    expect(riga).toMatch(/\b2 errori\b/);
    expect(riga).toMatch(/log di Vercel/);
    expect(JSON.stringify(finti.campanelle), 'la campanella non suona').toMatch(/2 errori/);
    const html = String((vi.mocked(sendEmail).mock.calls.at(-1)?.[0] as { html?: string } | undefined)?.html ?? '');
    expect(html, 'l\'email non parte').toContain('ERRORI_DEL_SITO');
  });

  it('l\'ora prima conta ancora, quella di tre ore fa no', async () => {
    logger.error(new Error('uno'));
    await finche(() => redis.size > 0);
    vi.setSystemTime(new Date('2026-11-21T11:05:00Z'));
    expect(tipi((await giro()).corpo)).toContain('ERRORI_DEL_SITO');
    finti.memoria.clear();
    vi.setSystemTime(new Date('2026-11-21T13:05:00Z'));
    expect(tipi((await giro()).corpo)).not.toContain('ERRORI_DEL_SITO');
  });

  it('controprova: nessun errore, nessun allarme sugli errori', async () => {
    expect(tipi((await giro()).corpo)).not.toContain('ERRORI_DEL_SITO');
  });

  it('il conto che non si legge non è «zero errori»: il sorvegliante dice che non l\'ha potuto guardare', async () => {
    upstashGiu = true;
    const { stato, corpo } = await giro();
    expect(corpo.controlliSaltati ?? []).toContain('conto degli errori del sito');
    expect(stato).toBe(500);
  });

  it('con Sentry acceso l\'allarme tace: gli errori li manda Sentry', async () => {
    process.env.SENTRY_DSN = 'https://chiave-finta@o1.ingest.de.sentry.io/2';
    logger.error(new Error('uno'));
    await finche(() => redis.size > 0);
    expect(tipi((await giro()).corpo)).not.toContain('ERRORI_DEL_SITO');
  });

  it('senza Upstash il logger non va in rete e il sorvegliante non si rompe', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    logger.error(new Error('uno'));
    await Promise.resolve();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(tipi((await giro()).corpo)).not.toContain('ERRORI_DEL_SITO');
  });

  it('il semaforo dice dove si vedono gli errori col registratore spento', async () => {
    const res = await salute(new Request('https://mycity.test/api/health'));
    const corpo = (await res.json()) as { checks?: Record<string, { error?: string }> };
    expect(corpo.checks?.registratore?.error).toMatch(/ERRORI_DEL_SITO/);
  });
});
