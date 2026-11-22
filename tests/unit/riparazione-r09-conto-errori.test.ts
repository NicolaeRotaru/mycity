/**
 * R09-005 — Il conto degli errori del sito (lib/logger.ts) chiamava Upstash una volta per ogni
 * `logger.error` del server, senza tempo massimo: in una tempesta di errori partiva una richiesta
 * per errore, e una chiamata che non rispondeva restava appesa. Qui il logger vero, un fetch finto e
 * un orologio finto: tanti errori in fila fanno al più una richiesta per finestra, il numero resta
 * giusto, e una chiamata che non risponde si interrompe entro pochi secondi.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock('@/lib/analytics/sentry', () => ({ captureError: vi.fn() }));

const UPSTASH = 'https://upstash-finto.test';
/** Il tetto che la prova accetta per una chiamata appesa (la cura ne usa meno). */
const TETTO_MS = 5_000;
/** Una finestra lunga quanto basta a chiudere qualunque finestra «breve» del logger. */
const FINESTRA_LARGA_MS = 60_000;

type Init = RequestInit & { signal?: AbortSignal };
let chiamate: Array<{ url: string; init: Init }> = [];

async function caricaLogger() {
  vi.resetModules();
  return (await import('@/lib/logger')).logger;
}

/** Quanti errori ha portato a Upstash la somma di tutte le chiamate (INCR vale 1, INCRBY n). */
function erroriPortati(): number {
  let somma = 0;
  for (const { init } of chiamate) {
    for (const [cmd, , n] of JSON.parse(String(init.body)) as unknown[][]) {
      if (cmd === 'INCR') somma += 1;
      if (cmd === 'INCRBY') somma += Number(n);
    }
  }
  return somma;
}

const giraIMicrotask = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

beforeEach(() => {
  for (const v of ['NEXT_PUBLIC_SENTRY_DSN', 'SENTRY_DSN', 'VERCEL_ENV']) delete process.env[v];
  process.env.UPSTASH_REDIS_REST_URL = UPSTASH;
  process.env.UPSTASH_REDIS_REST_TOKEN = 'gettone-finto';
  chiamate = [];
  for (const k of ['log', 'warn', 'error'] as const) vi.spyOn(console, k).mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(new Date('2026-11-21T10:20:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('il conto degli errori del sito non fa una richiesta per errore', () => {
  it('cinquanta errori nello stesso giro fanno una richiesta sola; una tempesta lunga ne fa poche e il numero resta intero', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: Init) => {
      chiamate.push({ url: String(url), init });
      return new Response('[]', { status: 200 });
    }));
    const logger = await caricaLogger();

    for (let i = 0; i < 50; i++) logger.error(new Error(`guasto ${i}`));
    await giraIMicrotask();
    expect(chiamate.length, `${chiamate.length} richieste a Upstash per 50 errori dello stesso giro`).toBe(1);
    expect(chiamate[0].url).toBe(`${UPSTASH}/pipeline`);

    // Duecentocinquanta errori, ognuno in un giro suo, nella stessa finestra: non duecentocinquanta richieste.
    for (let i = 0; i < 250; i++) {
      logger.error(new Error(`ancora ${i}`));
      await giraIMicrotask();
    }
    expect(chiamate.length, `${chiamate.length} richieste per 300 errori in una finestra`).toBeLessThanOrEqual(5);

    // A finestra chiusa parte il resto, tutto insieme.
    await vi.advanceTimersByTimeAsync(FINESTRA_LARGA_MS);
    expect(chiamate.length).toBeLessThanOrEqual(6);
    expect(erroriPortati(), 'il conto ha perso o raddoppiato degli errori').toBe(300);
    expect(JSON.stringify(chiamate.map((c) => c.init.body))).not.toMatch(/guasto|ancora/);

    // Finestre quiete dopo: nessuna richiesta in più.
    const fatte = chiamate.length;
    await vi.advanceTimersByTimeAsync(FINESTRA_LARGA_MS * 3);
    expect(chiamate.length).toBe(fatte);
  });

  it('dopo una finestra quieta il primo errore parte subito: l\'allarme non aspetta', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: Init) => {
      chiamate.push({ url: String(url), init });
      return new Response('[]', { status: 200 });
    }));
    const logger = await caricaLogger();
    // Si consuma la scorta con una tempesta lunga.
    for (let i = 0; i < 30; i++) {
      logger.error(new Error('x'));
      await giraIMicrotask();
    }
    const prima = chiamate.length;
    await vi.advanceTimersByTimeAsync(FINESTRA_LARGA_MS);
    const dopoLaTempesta = chiamate.length;
    logger.error(new Error('due'));
    await giraIMicrotask();
    expect(chiamate.length, 'il primo errore dopo la quiete non è partito subito').toBe(dopoLaTempesta + 1);
    expect(prima).toBeLessThan(30);
    expect(erroriPortati()).toBe(31);
  });

  it('una chiamata a Upstash che non risponde si interrompe entro il tetto, e il logger non lancia', async () => {
    const segnali: Array<AbortSignal | undefined> = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init: Init) => {
      chiamate.push({ url: String(url), init });
      segnali.push(init?.signal);
      // Come un fetch vero verso un servizio muto: risponde solo se lo si interrompe.
      return new Promise<Response>((_, rifiuta) => {
        init?.signal?.addEventListener('abort', () => rifiuta(new DOMException('interrotta', 'AbortError')));
      });
    }));
    const logger = await caricaLogger();

    expect(() => logger.error(new Error('Upstash muto'))).not.toThrow();
    await giraIMicrotask();
    expect(chiamate.length).toBe(1);
    expect(segnali[0], 'la chiamata a Upstash parte senza nessun modo di interromperla').toBeDefined();
    expect(segnali[0]!.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(TETTO_MS);
    expect(segnali[0]!.aborted, `dopo ${TETTO_MS} ms la chiamata a Upstash è ancora appesa`).toBe(true);
  });

  it('un fetch che lancia subito non rompe il logger', async () => {
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('rete rotta'); }));
    const logger = await caricaLogger();
    expect(() => { for (let i = 0; i < 5; i++) logger.error(new Error('x')); }).not.toThrow();
    await giraIMicrotask();
    await vi.advanceTimersByTimeAsync(FINESTRA_LARGA_MS);
  });
});
