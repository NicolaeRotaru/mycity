import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

/**
 * IL FRENO SI ALLARGAVA IN SILENZIO.
 *
 * Radiografia del 27/8/2026 (R190). Il freno anti-abuso conta le richieste su
 * Upstash, che e' condiviso fra tutte le copie del sito. Se Upstash non
 * risponde, si ripiega sul contatore in memoria — ed e' la scelta giusta:
 * meglio un freno largo che nessun freno.
 *
 * Ma avveniva senza dire niente a nessuno. Su Vercel «in memoria» vuol dire un
 * contatore per ogni copia accesa: «dieci tentativi al minuto» diventa dieci
 * per copia, e quante copie ci sono lo decide il traffico. Chi vuole forzare
 * una password non deve nemmeno accorgersene: gli basta bussare tanto. E
 * nessuno poteva sapere che era successo, ne' per quanto era durato.
 *
 * Le prove costruiscono un Upstash che non risponde e guardano se qualcuno se
 * ne lamenta.
 */

const salvato = { ...process.env };

async function carica() {
  vi.resetModules();
  return import('@/lib/rate-limit');
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.UPSTASH_REDIS_REST_URL = 'https://upstash.test';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'tok';
});

afterEach(() => {
  process.env = { ...salvato };
  vi.unstubAllGlobals();
});

describe('quando Upstash non risponde, il freno lo dice', () => {
  it('si lamenta al primo ripiego', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('connessione rifiutata'); }));
    const { rateLimitAsync, ripieghiDelFrenoDiRete } = await carica();

    const esito = await rateLimitAsync({ key: 'prova-1', max: 5, windowMs: 60_000 });

    // Il freno continua a funzionare: e' un ripiego, non una resa.
    expect(esito.allowed).toBe(true);
    expect(ripieghiDelFrenoDiRete()).toBe(1);
    expect(warn, 'Upstash e caduto e nessuno l ha scritto da nessuna parte').toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).toContain('freno');
  });

  it('si lamenta anche se Upstash risponde male invece di non rispondere', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 }) as unknown as Response));
    const { rateLimitAsync, ripieghiDelFrenoDiRete } = await carica();

    await rateLimitAsync({ key: 'prova-2', max: 5, windowMs: 60_000 });
    expect(ripieghiDelFrenoDiRete()).toBe(1);
    expect(warn).toHaveBeenCalled();
  });

  /**
   * Quando Upstash cade, cade per TUTTE le richieste: una riga a testa
   * riempirebbe i registri proprio quando servono leggibili. Si tiene il conto
   * di tutti, si scrive solo il primo e poi uno ogni cento.
   */
  it('non riempie i registri: conta tutti i ripieghi ma ne scrive uno ogni cento', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('giu'); }));
    const { rateLimitAsync, ripieghiDelFrenoDiRete } = await carica();

    for (let i = 0; i < 100; i++) {
      await rateLimitAsync({ key: `raffica-${i}`, max: 1000, windowMs: 60_000 });
    }

    expect(ripieghiDelFrenoDiRete(), 'i ripieghi vanno contati tutti').toBe(100);
    expect(warn.mock.calls.length, 'una riga per ripiego allagherebbe i registri').toBe(2);
  });

  it('quando Upstash risponde bene non si lamenta nessuno', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [{ result: 1 }, { result: 1 }],
    }) as unknown as Response));
    const { rateLimitAsync, ripieghiDelFrenoDiRete } = await carica();

    const esito = await rateLimitAsync({ key: 'prova-4', max: 5, windowMs: 60_000 });
    expect(esito.allowed).toBe(true);
    expect(ripieghiDelFrenoDiRete()).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });
});
