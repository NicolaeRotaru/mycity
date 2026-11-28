/**
 * R03-004 — Il giorno del lancio un errore del sito non lo vedeva nessuno: il registratore degli
 * errori (Sentry) è spento finché su Vercel non c'è il suo DSN, il semaforo non lo diceva e
 * l'allarme non ne sapeva niente. Scelta di Nicola (19/11): Sentry si accende prima del lancio, e il
 * codice deve partire da solo appena c'è il DSN. Qui:
 *  · col DSN finto il logger manda errori e avvisi a Sentry (finto);
 *  · il semaforo (/api/health) dice se il registratore è acceso, spento o acceso solo sul server;
 *  · il sorvegliante (operational-alerts), sul sito vero, avvisa col DSN mancante;
 *  · next.config.js accende Sentry col solo DSN: le mappe del codice solo con token, org e progetto.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
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
// R05-004 (onda 2) — Il sorvegliante legge anche i bonifici di rimborso ai clienti: qui nessuno da fare.
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (t: string) => tabella(t),
    rpc: async (nome: string) => (nome === 'admin_bonifici_rimborso' ? { data: [], error: null } : { data: null, error: { message: `rpc finta: ${nome}` } }),
  }),
}));

import { logger } from '@/lib/logger';
import { GET as salute } from '@/app/api/health/route';
import { POST as sorvegliante } from '@/app/api/cron/operational-alerts/route';
import { sendEmail } from '@/lib/email/client';

const DSN = 'https://chiave-finta@o1.ingest.de.sentry.io/2';
const VARIABILI = ['NEXT_PUBLIC_SENTRY_DSN', 'SENTRY_DSN', 'SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT', 'VERCEL_ENV'];
const salvato = { ...process.env };

beforeEach(() => {
  for (const v of VARIABILI) delete process.env[v];
  process.env.SUPPORT_EMAIL = 'nicola@mycity.test';
  process.env.LAVORI_A_ORARIO = 'accesi';
  finti.captureException.mockClear();
  finti.captureMessage.mockClear();
  finti.campanelle = [];
  finti.memoria.clear();
  vi.mocked(sendEmail).mockClear();
  for (const k of ['log', 'warn', 'error'] as const) vi.spyOn(console, k).mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  process.env = { ...salvato };
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('R03-004 · il logger, col DSN, manda a Sentry', () => {
  it('un errore del server va a Sentry.captureException', async () => {
    process.env.SENTRY_DSN = DSN;
    const err = new Error('rimborso fallito');
    logger.error(err, { ordine: 'ord_1' });
    await vi.waitFor(() => expect(finti.captureException).toHaveBeenCalledWith(err, { extra: { ordine: 'ord_1' } }));
  });

  it('un avviso del browser va a Sentry.captureMessage col livello «warning»', async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = DSN;
    vi.resetModules();
    vi.stubGlobal('window', {});
    const { logger: delBrowser } = await import('@/lib/logger');
    delBrowser.warn('carrello non sincronizzato');
    await vi.waitFor(() => expect(finti.captureMessage).toHaveBeenCalledWith('carrello non sincronizzato', { level: 'warning' }));
  });
});

async function chiediAlSemaforo() {
  const res = await salute(new Request('https://mycity.test/api/health'));
  return (await res.json()) as { status: string; registratoreErrori?: string; checks?: Record<string, { ok: boolean; stato?: string; error?: string }> };
}

describe('R03-004 · il semaforo dice se il registratore è acceso', () => {
  it('senza DSN: «spento», col motivo nel dettaglio, e il colore del semaforo non cambia per questo', async () => {
    const corpo = await chiediAlSemaforo();
    expect(corpo.registratoreErrori, 'il semaforo non dice niente del registratore').toBe('spento');
    expect(corpo.checks?.registratore).toMatchObject({ ok: false, stato: 'spento' });
    expect(corpo.checks?.registratore?.error).toMatch(/NEXT_PUBLIC_SENTRY_DSN/);
  });

  it('col DSN pubblico: «acceso»', async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = DSN;
    const corpo = await chiediAlSemaforo();
    expect(corpo.registratoreErrori).toBe('acceso');
    expect(corpo.checks?.registratore).toMatchObject({ ok: true, stato: 'acceso' });
  });

  it('col solo SENTRY_DSN: acceso solo sul server (il browser non lo vede)', async () => {
    process.env.SENTRY_DSN = DSN;
    const corpo = await chiediAlSemaforo();
    expect(corpo.registratoreErrori).toBe('acceso solo sul server');
    expect(corpo.checks?.registratore?.ok).toBe(false);
  });

  it('lo vede anche il monitor senza segreto, in produzione', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.CRON_SECRET = 'segreto-finto';
    const corpo = await chiediAlSemaforo();
    expect(corpo.checks, 'controprova: il monitor senza segreto non vede il dettaglio').toBeUndefined();
    expect(corpo.registratoreErrori).toBe('spento');
  });
});

async function giro() {
  const res = await sorvegliante({ url: 'http://localhost/api/cron/operational-alerts', headers: new Headers() } as unknown as NextRequest);
  return (await res.json()) as { details?: Array<{ type: string; detail: string }>; message?: string };
}
const tipi = (corpo: { details?: Array<{ type: string }> }) => (corpo.details ?? []).map((d) => d.type);

describe('R03-004 · il sorvegliante avvisa col registratore spento', () => {
  it('sul sito vero senza DSN: allarme REGISTRATORE_ERRORI_SPENTO, in campanella e per email', async () => {
    process.env.VERCEL_ENV = 'production';
    const corpo = await giro();
    expect(tipi(corpo), `il sorvegliante tace: ${JSON.stringify(corpo)}`).toContain('REGISTRATORE_ERRORI_SPENTO');
    expect(corpo.details!.find((d) => d.type === 'REGISTRATORE_ERRORI_SPENTO')!.detail).toMatch(/NEXT_PUBLIC_SENTRY_DSN/);
    expect(JSON.stringify(finti.campanelle)).toMatch(/registratore degli errori/i);
    const html = String((vi.mocked(sendEmail).mock.calls.at(-1)?.[0] as { html?: string } | undefined)?.html ?? '');
    expect(html).toContain('REGISTRATORE_ERRORI_SPENTO');
  });

  it('sul sito vero col solo SENTRY_DSN: avvisa che il browser non registra', async () => {
    process.env.VERCEL_ENV = 'production';
    process.env.SENTRY_DSN = DSN;
    const corpo = await giro();
    expect(corpo.details?.find((d) => d.type === 'REGISTRATORE_ERRORI_SPENTO')?.detail).toMatch(/solo sul server/);
  });

  it('due giri nello stesso giorno italiano: campanella ed email una volta sola; il giorno dopo, di nuovo', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    process.env.VERCEL_ENV = 'production';
    const avvisi = () => ({
      email: vi.mocked(sendEmail).mock.calls.filter((c) => String((c[0] as { html?: string }).html).includes('REGISTRATORE_ERRORI_SPENTO')).length,
      campanelle: finti.campanelle.filter((n) => /registratore degli errori/i.test(String(n.body))).length,
    });
    // Il 20 novembre, ora italiana: alle 0:30 (in UTC è ancora il 19), alle 7 e alle 23:30.
    for (const ora of ['2026-11-19T23:30:00Z', '2026-11-20T06:00:00Z', '2026-11-20T22:30:00Z']) {
      vi.setSystemTime(new Date(ora));
      expect(tipi(await giro()).filter((t) => t !== 'REGISTRATORE_ERRORI_SPENTO'), 'controprova: nessun altro allarme').toEqual([]);
    }
    expect(avvisi(), 'nello stesso giorno l’avviso è partito più di una volta').toEqual({ email: 1, campanelle: 1 });
    // Il 21 alle 8 italiane è passato più di un giorno dal primo: finché resta spento, torna.
    vi.setSystemTime(new Date('2026-11-21T07:00:00Z'));
    await giro();
    expect(avvisi(), 'il giorno dopo l’avviso non è tornato').toEqual({ email: 2, campanelle: 2 });
  });

  it('col DSN, o fuori dal sito vero, nessun allarme sul registratore', async () => {
    process.env.VERCEL_ENV = 'production';
    process.env.NEXT_PUBLIC_SENTRY_DSN = DSN;
    expect(tipi(await giro())).not.toContain('REGISTRATORE_ERRORI_SPENTO');
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    process.env.VERCEL_ENV = 'preview';
    expect(tipi(await giro())).not.toContain('REGISTRATORE_ERRORI_SPENTO');
  });
});

describe('R03-004 · next.config.js accende Sentry col solo DSN', () => {
  const richiedi = createRequire(import.meta.url);
  const percorsoConfig = richiedi.resolve('../../next.config.js');
  const percorsoSentry = richiedi.resolve('@sentry/nextjs');

  /** Carica next.config.js con un withSentryConfig finto che si ricorda le opzioni. */
  function caricaConfig(): { opzioni?: Record<string, unknown> } {
    const sentryVero = richiedi.cache[percorsoSentry];
    richiedi.cache[percorsoSentry] = {
      id: percorsoSentry, filename: percorsoSentry, loaded: true,
      exports: { withSentryConfig: (cfg: object, opzioni: Record<string, unknown>) => ({ ...cfg, __opzioniSentry: opzioni }) },
    } as unknown as NodeJS.Module;
    delete richiedi.cache[percorsoConfig];
    try {
      const config = richiedi(percorsoConfig) as { __opzioniSentry?: Record<string, unknown> };
      return { opzioni: config.__opzioniSentry };
    } finally {
      delete richiedi.cache[percorsoConfig];
      if (sentryVero) richiedi.cache[percorsoSentry] = sentryVero;
      else delete richiedi.cache[percorsoSentry];
    }
  }

  it('col DSN e senza token: Sentry si accende, le mappe non si caricano (il deploy non le chiede)', () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = DSN;
    const { opzioni } = caricaConfig();
    expect(opzioni, 'col DSN il costruttore non accende Sentry').toBeDefined();
    expect(opzioni!.sourcemaps, 'senza token il costruttore prova a caricare le mappe').toEqual({ disable: true });
    expect(opzioni!.tunnelRoute).toBe('/monitoring');
  });

  it('con token, organizzazione e progetto le mappe si caricano', () => {
    process.env.SENTRY_DSN = DSN;
    process.env.SENTRY_AUTH_TOKEN = 'gettone-finto';
    process.env.SENTRY_ORG = 'mycity';
    process.env.SENTRY_PROJECT = 'mycity';
    const { opzioni } = caricaConfig();
    expect(opzioni!.sourcemaps).toEqual({ disable: false });
    expect(opzioni!.authToken).toBe('gettone-finto');
  });

  it('col token ma senza progetto le mappe restano spente, e senza DSN Sentry non entra', () => {
    process.env.SENTRY_DSN = DSN;
    process.env.SENTRY_AUTH_TOKEN = 'gettone-finto';
    expect(caricaConfig().opzioni!.sourcemaps).toEqual({ disable: true });
    delete process.env.SENTRY_DSN;
    expect(caricaConfig().opzioni).toBeUndefined();
  });
});

describe('R03-004 · il runbook dice a Nicola come accenderlo', () => {
  it('nomina la chiave che il codice legge, il deploy da rifare, il semaforo e l’allarme', async () => {
    const { readFileSync } = await import('node:fs');
    const runbook = readFileSync('docs/runbook.md', 'utf8');
    const sezione = runbook.slice(runbook.indexOf('Registratore degli errori'));
    expect(runbook, 'nel runbook manca la sezione sul registratore degli errori').toContain('Registratore degli errori');
    for (const voce of ['NEXT_PUBLIC_SENTRY_DSN', 'Redeploy', 'registratoreErrori', 'REGISTRATORE_ERRORI_SPENTO', 'SENTRY_AUTH_TOKEN']) {
      expect(sezione, `la sezione non dice «${voce}»`).toContain(voce);
    }
  });
});
