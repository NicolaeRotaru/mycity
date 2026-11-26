import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';

/**
 * R20-002 — Il tetto giornaliero di spesa AI in produzione non era condiviso:
 * ogni copia del sito contava per se'.
 *
 * Tre modi, provati qui con un conto condiviso finto (lo stesso per tutte le
 * copie, come il database) e due «copie» del sito (due istanze del modulo,
 * vi.resetModules, ognuna con la sua memoria), in rete (Vercel) e senza Upstash:
 *   ① conto a 99 su 100, due chiamate insieme da due copie: ne passa una sola;
 *   ② una scrittura della spesa persa: la spesa e' gia' nel conto (la
 *      prenotazione resta al suo posto), e le altre copie non vanno oltre il tetto;
 *   ③ il conto che non si legge: errore temporaneo, e il modello non si chiama.
 * Sul computer di chi sviluppa (e con `vercel dev`) il ripiego in memoria resta.
 *
 * Il conto finto si comporta come la funzione della migrazione 980: aggiunge,
 * restituisce con un numero negativo, mai sotto zero.
 */

const GIORNO = '2026-11-26';

const conto = vi.hoisted(() => ({
  cents: new Map<string, number>(),
  /** null = risponde; un errore = come in produzione (la funzione non c'e'); 'timeout' = non risponde. */
  guasto: null as null | 'timeout' | { code?: string; message: string },
  /** La prossima scrittura positiva si perde (la rete cade fra la copia e il database). */
  perdiLaProssimaScrittura: false,
  creaMessaggio: null as unknown as Mock<(...a: unknown[]) => Promise<unknown>>,
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), spesa: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    rpc: async (nome: string, args: { p_giorno?: string; p_cents?: number }) => {
      await new Promise((r) => setTimeout(r, 2));
      if (conto.guasto === 'timeout') throw new Error('The operation was aborted due to timeout');
      if (conto.guasto) return { data: null, error: conto.guasto };
      const giorno = String(args.p_giorno);
      if (nome === 'registra_spesa_ai') {
        const p = Number(args.p_cents ?? 0);
        if (p > 0 && conto.perdiLaProssimaScrittura) {
          conto.perdiLaProssimaScrittura = false;
          return { data: null, error: { message: 'fetch failed' } };
        }
        const n = Math.max(0, (conto.cents.get(giorno) ?? 0) + p);
        conto.cents.set(giorno, n);
        return { data: n, error: null };
      }
      if (nome === 'spesa_ai_di_oggi') return { data: conto.cents.get(giorno) ?? 0, error: null };
      return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${nome}` } };
    },
  }),
}));

vi.mock('@/lib/ai/client', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/client')>();
  return {
    ...actual,
    getAnthropic: () => ({ messages: { create: (...a: unknown[]) => conto.creaMessaggio(...a) } }),
    segnalaModelloRitirato: () => false,
  };
});

import { MODELS } from '@/lib/ai/client';

type ModuloRun = typeof import('@/lib/ai/run');

/** Una copia del sito: memoria sua, conto condiviso in comune. */
async function unaCopia(): Promise<ModuloRun> {
  vi.resetModules();
  return import('@/lib/ai/run');
}

const speso = () => conto.cents.get(GIORNO) ?? 0;

const domanda = {
  feature: 'ai-description',
  model: MODELS.fast,
  max_tokens: 50,
  messages: [{ role: 'user' as const, content: 'Scrivi una riga sul pane.' }],
};

function inRete(ambiente: 'production' | 'preview' = 'production') {
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('VERCEL_ENV', ambiente);
}

async function rifiuto(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => null,
    (e: unknown) => e,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-26T10:00:00+01:00'));
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('VERCEL_ENV', '');
  vi.stubEnv('UPSTASH_REDIS_REST_URL', ''); // senza Upstash
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
  vi.stubEnv('AI_GLOBAL_DAILY_BUDGET_EUR', '1'); // 100 centesimi
  conto.cents.clear();
  conto.guasto = null;
  conto.perdiLaProssimaScrittura = false;
  conto.creaMessaggio = vi.fn(async () => ({
    content: [{ type: 'text', text: 'Pane buono.' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 20, output_tokens: 10 },
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('in rete il tetto e\' uno solo per tutte le copie, anche senza Upstash', () => {
  it('a 99 su 100, due copie che chiamano insieme: ne passa una sola', async () => {
    inRete();
    conto.cents.set(GIORNO, 99);
    const a = await unaCopia();
    const b = await unaCopia();

    const esiti = await Promise.allSettled([a.controllaTettoSpesaAi('copia-a', 1), b.controllaTettoSpesaAi('copia-b', 1)]);
    const passate = esiti.filter((e) => e.status === 'fulfilled');
    const fermate = esiti.filter((e) => e.status === 'rejected');
    expect(passate, 'due copie a 99 su 100 non passano tutte e due').toHaveLength(1);
    expect(fermate).toHaveLength(1);
    expect(((fermate[0] as PromiseRejectedResult).reason as { motivo?: string }).motivo).toBe('tetto_spesa');
    expect(speso()).toBeLessThanOrEqual(100);

    // Quella che e' passata spende davvero un centesimo e chiude: il conto dice 100.
    const vincitrice = esiti[0].status === 'fulfilled' ? a : b;
    await vincitrice.registraSpesaAi(0.01);
    await (passate[0] as PromiseFulfilledResult<() => Promise<void>>).value();
    expect(speso()).toBe(100);
  });

  it('con runMessage: due copie insieme sull\'ultimo pezzo di tetto, il modello si chiama una volta sola', async () => {
    inRete();
    const a = await unaCopia();
    const b = await unaCopia();
    const stima = a.stimaCostoChiamataCents(domanda);
    expect(stima).toBeGreaterThan(0);
    conto.cents.set(GIORNO, 100 - stima);

    const esiti = await Promise.allSettled([a.runMessage(domanda), b.runMessage(domanda)]);
    expect(conto.creaMessaggio).toHaveBeenCalledTimes(1);
    const fermate = esiti.filter((e) => e.status === 'rejected');
    expect(fermate).toHaveLength(1);
    expect(((fermate[0] as PromiseRejectedResult).reason as { motivo?: string }).motivo).toBe('tetto_spesa');
  });
});

describe('in rete una scrittura persa non lascia spendere le altre copie oltre il tetto', () => {
  it('il lotto del catalogo: la spesa non scritta e\' gia\' nel conto, anche se la copia si spegne', async () => {
    inRete();
    const a = await unaCopia();
    const libera = await a.controllaTettoSpesaAi('ai-catalog-batch-start', 70);
    conto.perdiLaProssimaScrittura = true;
    await a.registraSpesaAi(0.6); // la scrittura del costo si perde
    await libera();
    // La copia A si spegne qui: niente di quello che sa resta.

    expect(speso(), 'la spesa della copia A deve stare nel conto di tutti').toBeGreaterThanOrEqual(60);
    const b = await unaCopia();
    const errore = await rifiuto(b.controllaTettoSpesaAi('copia-b', 70));
    expect((errore as { motivo?: string } | null)?.motivo).toBe('tetto_spesa');
    // Quello che resta davvero sotto il tetto si puo' ancora spendere.
    await expect(b.controllaTettoSpesaAi('copia-b', 30)).resolves.toBeTypeOf('function');
    expect(speso()).toBeLessThanOrEqual(100);
  });

  it('il costo oltre la stima che non si e\' scritto entra nel conto con la prenotazione dopo', async () => {
    inRete();
    const a = await unaCopia();
    const libera = await a.controllaTettoSpesaAi('copia-a', 50);
    conto.perdiLaProssimaScrittura = true;
    await a.registraSpesaAi(0.8); // costava 80, non 50, e la scrittura si perde
    await libera();

    await a.controllaTettoSpesaAi('copia-a', 10);
    expect(speso(), '80 spesi + 10 prenotati').toBeGreaterThanOrEqual(90);
    const b = await unaCopia();
    const errore = await rifiuto(b.controllaTettoSpesaAi('copia-b', 20));
    expect((errore as { motivo?: string } | null)?.motivo).toBe('tetto_spesa');
  });

  it('una chiamata finita bene restituisce la prenotazione: nel conto resta il costo vero', async () => {
    inRete();
    const a = await unaCopia();
    const libera = await a.controllaTettoSpesaAi('copia-a', 40);
    expect(speso()).toBe(40);
    await a.registraSpesaAi(0.05);
    await libera();
    expect(speso()).toBe(5);
  });
});

describe('in rete il conto che non si legge ferma l\'AI con un errore temporaneo', () => {
  it.each([
    ['la funzione non c\'e\' (come oggi in produzione)', { code: 'PGRST202', message: 'Could not find the function public.registra_spesa_ai(p_cents, p_giorno) in the schema cache' }],
    ['il conto non risponde (timeout)', 'timeout' as const],
  ])('%s: nessuna chiamata al modello, 503 «riprova fra qualche minuto»', async (_nome, guasto) => {
    inRete();
    conto.guasto = guasto;
    const copia = await unaCopia();
    // Anche dopo la pausa del circuito (tre fallimenti di fila) la risposta non cambia.
    for (let i = 0; i < 5; i++) {
      const errore = await rifiuto(copia.runMessage(domanda));
      expect(errore).toBeInstanceOf(copia.AiCallError);
      expect((errore as { status?: number }).status).toBe(503);
      expect((errore as { motivo?: string }).motivo).not.toBe('tetto_spesa');
      const risposta = copia.mapAiError(errore, 'ai-description');
      expect(risposta.status).toBe(503);
      const testo = JSON.stringify(await risposta.json());
      expect(testo).toMatch(/qualche minuto/);
      expect(testo).not.toMatch(/Budget|domani/i);
    }
    expect(conto.creaMessaggio, 'senza il conto del sito il modello a pagamento non si chiama').not.toHaveBeenCalled();
  });

  it('vale anche per le anteprime (VERCEL_ENV=preview)', async () => {
    inRete('preview');
    conto.guasto = 'timeout';
    const copia = await unaCopia();
    await expect(copia.runMessage(domanda)).rejects.toMatchObject({ status: 503 });
    expect(conto.creaMessaggio).not.toHaveBeenCalled();
  });
});

describe('sul computer di chi sviluppa il ripiego in memoria resta com\'era', () => {
  it.each([
    ['senza Vercel', () => undefined],
    ['con vercel dev (VERCEL_ENV=development)', () => { vi.stubEnv('VERCEL', '1'); vi.stubEnv('VERCEL_ENV', 'development'); }],
  ])('%s: il conto che non risponde non ferma il modello', async (_nome, ambiente) => {
    ambiente();
    conto.guasto = { code: 'PGRST202', message: 'Could not find the function public.spesa_ai_di_oggi(p_giorno) in the schema cache' };
    const copia = await unaCopia();
    const risultato = await copia.runMessage(domanda);
    expect(risultato.text).toBe('Pane buono.');
    expect(conto.creaMessaggio).toHaveBeenCalledTimes(1);
  });
});
