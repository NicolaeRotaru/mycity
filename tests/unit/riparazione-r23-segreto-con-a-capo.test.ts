import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * R23-009 (13/11/2026) — IL SEGRETO DEI LAVORI CON L'«A CAPO» IN FONDO.
 *
 * Su Vercel un valore incollato porta spesso un «a capo» finale. Il gettone che arriva con
 * `Authorization: Bearer …` si ripuliva, il segreto atteso no: i due non combaciavano mai.
 * Anche il primo giro a mano di un lavoro rispondeva «non autorizzato», e le due porte di
 * stato (/api/health e /api/health/ready) non mostravano il dettaglio a chi aveva il segreto.
 *
 * Qui il segreto su «Vercel» è `segreto-dei-lavori\n`, e chi bussa manda `segreto-dei-lavori`.
 */

const { avvisi } = vi.hoisted(() => ({ avvisi: [] as string[] }));

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: (msg: string) => { avvisi.push(msg); },
    error: (msg: string) => { avvisi.push(msg); },
    info: () => {},
    debug: () => {},
  },
}));

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => ({
      // Il battito del lavoro, la prova del database e la lettura dei battiti.
      upsert: async () => ({ error: null }),
      select: () =>
        tabella === 'cron_heartbeats'
          ? Promise.resolve({ data: [], error: null })
          : { limit: async () => ({ error: null }) },
    }),
  }),
}));

const SEGRETO = 'segreto-dei-lavori';

function bussa(indirizzo: string, gettone: string | null): Request {
  return new Request(indirizzo, {
    headers: gettone ? { authorization: `Bearer ${gettone}` } : {},
  });
}

beforeEach(() => {
  avvisi.length = 0;
  vi.resetModules();
  vi.stubEnv('CRON_SECRET', `${SEGRETO}\n`);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('il lavoro periodico, con il segreto che finisce con un «a capo»', () => {
  it('il primo giro a mano col segreto giusto entra nel lavoro', async () => {
    const { withCronAuth } = await import('@/lib/api/middleware');
    const lavoro = vi.fn(async () => NextResponse.json({ fatto: true }));
    const rotta = withCronAuth(lavoro);

    const risposta = await rotta(bussa('https://mycity.test/api/cron/prova', SEGRETO) as unknown as NextRequest);

    expect(risposta.status, 'il segreto giusto risponde «non autorizzato»').toBe(200);
    expect(lavoro).toHaveBeenCalledTimes(1);
  });

  it('un segreto diverso resta fuori', async () => {
    const { withCronAuth } = await import('@/lib/api/middleware');
    const lavoro = vi.fn(async () => NextResponse.json({ fatto: true }));
    const risposta = await withCronAuth(lavoro)(
      bussa('https://mycity.test/api/cron/prova', 'segreto-sbagliato') as unknown as NextRequest,
    );
    expect(risposta.status).toBe(401);
    expect(lavoro).not.toHaveBeenCalled();
  });

  it('un segreto fatto solo di «a capo» vale come assente: 503, non una porta aperta', async () => {
    vi.stubEnv('CRON_SECRET', '\n');
    const { withCronAuth } = await import('@/lib/api/middleware');
    const lavoro = vi.fn(async () => NextResponse.json({ fatto: true }));
    const risposta = await withCronAuth(lavoro)(
      bussa('https://mycity.test/api/cron/prova', null) as unknown as NextRequest,
    );
    expect(risposta.status).toBe(503);
    expect(lavoro).not.toHaveBeenCalled();
  });
});

describe('le porte di stato in produzione, col segreto che finisce con un «a capo»', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
  });

  it('/api/health mostra il dettaglio a chi manda il segreto giusto', async () => {
    const { GET } = await import('@/app/api/health/route');
    const corpo = await (await GET(bussa('https://mycity.test/api/health', SEGRETO))).json();
    expect(corpo.checks, 'chi ha il segreto riceve la risposta pubblica').toBeDefined();
  });

  it('/api/health senza segreto resta pubblica: niente dettaglio', async () => {
    const { GET } = await import('@/app/api/health/route');
    const corpo = await (await GET(bussa('https://mycity.test/api/health', null))).json();
    expect(corpo.checks).toBeUndefined();
  });

  it('/api/health/ready mostra il dettaglio del database a chi manda il segreto giusto', async () => {
    const { GET } = await import('@/app/api/health/ready/route');
    const corpo = await (
      await GET(bussa('https://mycity.test/api/health/ready', SEGRETO) as unknown as NextRequest)
    ).json();
    expect(corpo.db, 'chi ha il segreto riceve la risposta pubblica').toBeDefined();
  });

  it('/api/health/ready senza segreto resta pubblica: niente dettaglio', async () => {
    const { GET } = await import('@/app/api/health/ready/route');
    const corpo = await (
      await GET(bussa('https://mycity.test/api/health/ready', 'segreto-sbagliato') as unknown as NextRequest)
    ).json();
    expect(corpo.db).toBeUndefined();
  });
});
