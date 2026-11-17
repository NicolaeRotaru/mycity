/**
 * Con Upstash il freno dell'accesso diceva sempre «aspetta la finestra intera».
 *
 * Il contatore condiviso nasce al primo tentativo e scade dopo la finestra: a metà finestra
 * mancano trenta secondi, non sessanta. Il freno rispondeva sempre ttlSec, cioè la finestra
 * intera, e chi era bloccato aspettava il doppio del necessario (e la pagina gli contava alla
 * rovescia un tempo falso). Il tempo che manca lo sa solo Upstash: si chiede nella stessa
 * pipeline (PTTL) e si risponde con quello.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const salvato = { ...process.env };

async function carica() {
  vi.resetModules();
  return import('@/lib/rate-limit');
}

/** Un Upstash finto: la chiave nasce al primo INCR e scade dopo la finestra, sull'orologio finto. */
function upstashFinto() {
  const chiavi = new Map<string, { n: number; scadeAt: number | null }>();
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const comandi = JSON.parse(String(init?.body)) as string[][];
    const ora = Date.now();
    const risultati = comandi.map(([cmd, chiave, arg]) => {
      let c = chiavi.get(chiave);
      if (c && c.scadeAt !== null && c.scadeAt <= ora) { chiavi.delete(chiave); c = undefined; }
      if (cmd === 'INCR') {
        if (!c) { c = { n: 0, scadeAt: null }; chiavi.set(chiave, c); }
        c.n += 1;
        return { result: c.n };
      }
      if (cmd === 'EXPIRE') {
        if (!c) return { result: 0 };
        if (c.scadeAt === null) { c.scadeAt = ora + Number(arg) * 1000; return { result: 1 }; }
        return { result: 0 };
      }
      if (cmd === 'PTTL') {
        if (!c) return { result: -2 };
        return { result: c.scadeAt === null ? -1 : c.scadeAt - ora };
      }
      return { error: `comando inatteso ${cmd}` };
    });
    return { ok: true, status: 200, json: async () => risultati } as unknown as Response;
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-17T10:00:00Z'));
  process.env.UPSTASH_REDIS_REST_URL = 'https://upstash.test';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'tok';
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  process.env = { ...salvato };
});

describe('con Upstash il freno dice quanto manca davvero', () => {
  it('bloccato a metà finestra: aspetta i trenta secondi che mancano, non i sessanta della finestra', async () => {
    vi.stubGlobal('fetch', upstashFinto());
    const { rateLimitAsync } = await carica();
    const opzioni = { key: 'signin:1.2.3.4', max: 2, windowMs: 60_000 };

    expect((await rateLimitAsync(opzioni)).allowed).toBe(true);
    expect((await rateLimitAsync(opzioni)).allowed).toBe(true);

    vi.setSystemTime(new Date('2026-11-17T10:00:30Z'));
    const bloccato = await rateLimitAsync(opzioni);
    expect(bloccato.allowed).toBe(false);
    expect(bloccato.retryAfterSec, 'mancano 30 secondi alla fine della finestra di Upstash').toBe(30);

    vi.setSystemTime(new Date('2026-11-17T10:00:59.200Z'));
    const quasi = await rateLimitAsync(opzioni);
    expect(quasi.allowed).toBe(false);
    expect(quasi.retryAfterSec, 'manca meno di un secondo: si arrotonda a uno, mai a zero').toBe(1);

    vi.setSystemTime(new Date('2026-11-17T10:01:00Z'));
    expect((await rateLimitAsync(opzioni)).allowed, 'finita la finestra si riparte').toBe(true);
  });

  it('se Upstash non dice quanto manca, resta la finestra intera', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [{ result: 3 }, { result: 0 }, { result: -1 }],
    }) as unknown as Response));
    const { rateLimitAsync } = await carica();
    const esito = await rateLimitAsync({ key: 'signin:5.6.7.8', max: 2, windowMs: 60_000 });
    expect(esito.allowed).toBe(false);
    expect(esito.retryAfterSec).toBe(60);
  });
});
