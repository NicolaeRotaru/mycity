import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * R23-017 (13/11/2026) — IL FRENO CONTRO CHI PROVA MILLE PASSWORD, SENZA CONTATORE CONDIVISO.
 *
 * Senza Upstash (URL e token) il freno conta in memoria: su Vercel un contatore per ogni copia
 * del sito, e il limite scritto nel codice vale per copia. Quando Upstash non risponde il freno
 * lo diceva gia' (il-freno-che-si-allarga-lo-dice.test.ts); quando non e' proprio configurato
 * taceva. In produzione adesso lo dice, una volta sola per copia; fuori dalla produzione no.
 */

const { errori } = vi.hoisted(() => ({ errori: [] as Array<{ msg: string; ctx?: Record<string, unknown> }> }));
vi.mock('@/lib/logger', () => ({
  logger: {
    error: (msg: unknown, ctx?: Record<string, unknown>) => { errori.push({ msg: String(msg), ctx }); },
    warn: () => {}, info: () => {}, debug: () => {},
  },
}));

async function carica() {
  vi.resetModules();
  return import('@/lib/rate-limit');
}

beforeEach(() => {
  errori.length = 0;
  vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const accesso = (i: number) => ({ key: `signin:10.0.0.1:${i}`, max: 10, windowMs: 60_000 });

describe('in produzione, senza il contatore condiviso', () => {
  it('il freno lo scrive, una volta sola, e continua a frenare', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { rateLimitAsync } = await carica();

    for (let i = 0; i < 5; i++) {
      const esito = await rateLimitAsync(accesso(i));
      expect(esito.allowed, 'il ripiego in memoria deve frenare comunque').toBe(true);
    }

    const righe = errori.filter((e) => e.msg.includes('contatore condiviso'));
    expect(righe.length, 'il freno vale per ogni copia del sito e nessuno lo scrive').toBe(1);
    expect(righe[0].ctx).toMatchObject({ url: false, token: false });
  });

  it('con mezza coppia (l indirizzo senza il token) lo scrive lo stesso, e dice quale manca', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://upstash.test');
    const { rateLimitAsync } = await carica();

    await rateLimitAsync(accesso(1));

    const riga = errori.find((e) => e.msg.includes('contatore condiviso'));
    expect(riga, 'mezza coppia ripiega in memoria in silenzio').toBeTruthy();
    expect(riga?.ctx).toMatchObject({ url: true, token: false });
    expect(JSON.stringify(riga?.ctx), 'mai i valori delle variabili nel registro').not.toContain('upstash.test');
  });
});

describe('fuori dalla produzione il contatore in memoria e quello giusto', () => {
  it('nessuna riga d errore', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const { rateLimitAsync } = await carica();
    await rateLimitAsync(accesso(1));
    expect(errori).toEqual([]);
  });
});
