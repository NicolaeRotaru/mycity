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

/**
 * R23-009 correzione (14/11/2026) — Lo stesso «a capo» sugli altri due segreti dello stesso giro.
 *
 * Il collaudo (K06) ha trovato il gemello su INTERNAL_API_SECRET, che apre /api/stripe/payout, e su
 * EDGE_TRUST_SECRET, che fa credere alla riga di Cloudflare con l'indirizzo vero. Fallivano chiusi,
 * quindi non era un buco: ma la porta restava chiusa anche a chi aveva diritto. Qui la regola è la
 * stessa di CRON_SECRET: un «a capo» in fondo non cambia il segreto, un segreto di soli spazi è
 * assente, e niente entra con un segreto diverso o vuoto.
 */
const INTERNO = 'segreto-interno';

function bussaDentro(segreto: string | null): NextRequest {
  return new Request('https://mycity.test/api/stripe/payout', {
    method: 'POST',
    headers: segreto === null ? {} : { 'x-internal-secret': segreto },
  }) as unknown as NextRequest;
}

describe('la rotta interna (payout), con INTERNAL_API_SECRET che finisce con un «a capo»', () => {
  beforeEach(() => {
    vi.stubEnv('INTERNAL_API_SECRET', `${INTERNO}\n`);
  });

  it('chi manda il segreto giusto entra, invece di prendere 403 per sempre', async () => {
    const { withInternalAuth } = await import('@/lib/api/middleware');
    const lavoro = vi.fn(async () => NextResponse.json({ fatto: true }));
    const risposta = await withInternalAuth(lavoro)(bussaDentro(INTERNO));
    expect(risposta.status, 'il segreto giusto risponde 403').toBe(200);
    expect(lavoro).toHaveBeenCalledTimes(1);
  });

  it('anche con «\\r\\n» in fondo (incollato da Windows) il segreto giusto entra', async () => {
    vi.stubEnv('INTERNAL_API_SECRET', `${INTERNO}\r\n`);
    const { withInternalAuth } = await import('@/lib/api/middleware');
    const lavoro = vi.fn(async () => NextResponse.json({ fatto: true }));
    expect((await withInternalAuth(lavoro)(bussaDentro(INTERNO))).status).toBe(200);
  });

  it('un segreto diverso, un prefisso o nessuna intestazione restano fuori (403)', async () => {
    const { withInternalAuth } = await import('@/lib/api/middleware');
    const lavoro = vi.fn(async () => NextResponse.json({ fatto: true }));
    const rotta = withInternalAuth(lavoro);
    for (const gettone of ['segreto-sbagliato', 'segreto-intern', `${INTERNO}x`, '', null]) {
      expect((await rotta(bussaDentro(gettone))).status, `entra con ${JSON.stringify(gettone)}`).toBe(403);
    }
    expect(lavoro).not.toHaveBeenCalled();
  });

  it('un segreto fatto solo di spazi o «a capo» vale come assente: 503, e nessuno entra', async () => {
    for (const vuoto of ['\n', '   ', ' \r\n\t']) {
      vi.stubEnv('INTERNAL_API_SECRET', vuoto);
      vi.resetModules();
      const { withInternalAuth } = await import('@/lib/api/middleware');
      const lavoro = vi.fn(async () => NextResponse.json({ fatto: true }));
      const rotta = withInternalAuth(lavoro);
      for (const gettone of [null, '', ' ', vuoto]) {
        expect((await rotta(bussaDentro(gettone))).status, `segreto ${JSON.stringify(vuoto)}, gettone ${JSON.stringify(gettone)}`).toBe(503);
      }
      expect(lavoro).not.toHaveBeenCalled();
    }
  });
});

describe("l'indirizzo vero dietro Cloudflare, con EDGE_TRUST_SECRET che finisce con un «a capo»", () => {
  function daCloudflare(gettone: string | null): Request {
    return new Request('https://mycity.test/api/qualcosa', {
      headers: {
        ...(gettone === null ? {} : { 'x-edge-token': gettone }),
        'cf-connecting-ip': '203.0.113.7',
        'x-forwarded-for': '198.51.100.9',
      },
    });
  }

  it('col gettone di bordo giusto vale la riga di Cloudflare', async () => {
    vi.stubEnv('EDGE_TRUST_SECRET', 'bordo-fidato\n');
    const { getClientIp } = await import('@/lib/rate-limit');
    expect(getClientIp(daCloudflare('bordo-fidato')), 'il bordo fidato non combacia mai').toBe('203.0.113.7');
  });

  it('senza gettone, o con uno sbagliato, la riga di Cloudflare resta ignorata', async () => {
    vi.stubEnv('EDGE_TRUST_SECRET', 'bordo-fidato\n');
    const { getClientIp } = await import('@/lib/rate-limit');
    for (const gettone of [null, '', 'bordo-sbagliato', 'bordo-fidat', 'bordo-fidato x']) {
      expect(getClientIp(daCloudflare(gettone)), `crede a Cloudflare con ${JSON.stringify(gettone)}`).toBe('198.51.100.9');
    }
  });

  it('un segreto di bordo fatto solo di spazi non fa credere a nessuno', async () => {
    for (const vuoto of ['\n', '   ', ' \r\n']) {
      vi.stubEnv('EDGE_TRUST_SECRET', vuoto);
      vi.resetModules();
      const { getClientIp } = await import('@/lib/rate-limit');
      for (const gettone of [null, '', ' ', vuoto]) {
        expect(getClientIp(daCloudflare(gettone)), `segreto ${JSON.stringify(vuoto)}, gettone ${JSON.stringify(gettone)}`).toBe('198.51.100.9');
      }
    }
  });
});
