import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * R03-013 — Il tetto di spesa AI del giorno si sforava quando piu' chiamate
 * partivano insieme. Dentro una copia la prenotazione c'era gia' (R04-017); fra
 * due copie diverse no: leggevano lo stesso «speso», nessuna vedeva la stima
 * dell'altra, e passavano tutte e due. Adesso la stima si prenota anche nel
 * contatore condiviso (Upstash), prima di leggere lo speso.
 *
 * Le due «copie» sono due istanze dello stesso modulo (vi.resetModules), ognuna
 * con la sua memoria; il conto del giorno e il contatore condiviso sono finti
 * ma unici, come in produzione.
 */

const stato = vi.hoisted(() => ({
  centsDelGiorno: 0,
  redis: new Map<string, number>(),
  comandi: [] as string[][],
}));

const attesa = (ms: number) => new Promise((r) => setTimeout(r, ms));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), spesa: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    rpc: async (nome: string, args: { p_cents?: number }) => {
      await attesa(5);
      if (nome === 'registra_spesa_ai') stato.centsDelGiorno += Number(args.p_cents ?? 0);
      return { data: stato.centsDelGiorno, error: null };
    },
  }),
}));

/** Un Upstash finto: la pipeline REST con INCRBY, DECRBY, EXPIRE e MGET. */
function upstashFinto() {
  return vi.fn(async (url: unknown, init?: { body?: unknown }) => {
    if (!String(url).startsWith('https://upstash.finto')) throw new Error(`rete vietata: ${String(url)}`);
    const comandi = JSON.parse(String(init?.body ?? '[]')) as string[][];
    const risultati = comandi.map((c) => {
      stato.comandi.push(c);
      const [nome, chiave, ...resto] = c;
      if (nome === 'INCRBY' || nome === 'DECRBY') {
        const delta = Number(resto[0]) * (nome === 'DECRBY' ? -1 : 1);
        const valore = (stato.redis.get(chiave) ?? 0) + delta;
        stato.redis.set(chiave, valore);
        return { result: valore };
      }
      if (nome === 'EXPIRE') return { result: 1 };
      if (nome === 'MGET') {
        return { result: [chiave, ...resto].map((k) => (stato.redis.has(k) ? String(stato.redis.get(k)) : null)) };
      }
      return { error: `comando sconosciuto ${nome}` };
    });
    return new Response(JSON.stringify(risultati), { status: 200 });
  });
}

type ModuloRun = typeof import('@/lib/ai/run');

async function unaCopia(): Promise<ModuloRun> {
  vi.resetModules();
  return import('@/lib/ai/run');
}

describe('il tetto regge anche fra copie diverse del sito', () => {
  beforeEach(() => {
    stato.centsDelGiorno = 0;
    stato.redis.clear();
    stato.comandi.length = 0;
    vi.stubEnv('AI_GLOBAL_DAILY_BUDGET_EUR', '0.10'); // 10 centesimi
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://upstash.finto');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token-finto');
    vi.stubGlobal('fetch', upstashFinto());
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('due copie, due stime da 6 centesimi su un tetto di 10: ne passa una sola', async () => {
    const copiaA = await unaCopia();
    const copiaB = await unaCopia();
    expect(copiaA).not.toBe(copiaB);

    const esiti = await Promise.allSettled([
      copiaA.controllaTettoSpesaAi('prova-a', 6),
      copiaB.controllaTettoSpesaAi('prova-b', 6),
    ]);
    const passate = esiti.filter((e) => e.status === 'fulfilled');
    const fermate = esiti.filter(
      (e) => e.status === 'rejected' && (e.reason as { motivo?: string }).motivo === 'tetto_spesa',
    );
    expect(passate).toHaveLength(1);
    expect(fermate).toHaveLength(1);

    // Chi passa spende, registra e poi libera: niente resta prenotato nel contatore condiviso.
    const libera = (passate[0] as PromiseFulfilledResult<() => Promise<void> | void>).value;
    await libera();
    const prenotatoDopo = Array.from(stato.redis.values()).reduce((s, v) => s + v, 0);
    expect(prenotatoDopo).toBe(0);
  });

  it('finita la prima chiamata e registrata la spesa, la copia dopo vede lo speso vero', async () => {
    const copiaA = await unaCopia();
    const copiaB = await unaCopia();
    const libera = await copiaA.controllaTettoSpesaAi('prova-a', 6);
    stato.centsDelGiorno = 6; // la chiamata di A e' costata quanto stimato
    await libera();
    await expect(copiaB.controllaTettoSpesaAi('prova-b', 6)).rejects.toMatchObject({ motivo: 'tetto_spesa' });
    await expect(copiaB.controllaTettoSpesaAi('prova-b', 4)).resolves.toBeTypeOf('function');
  });
});
