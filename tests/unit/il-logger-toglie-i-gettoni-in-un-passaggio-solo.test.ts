import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Il logger toglie i gettoni JWT dal testo con un passaggio solo: il tempo segue la lunghezza del
 * testo. E toglie esattamente quello che toglieva la regola di prima,
 * `/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g`: la prova lo confronta su migliaia di testi a caso.
 */

vi.mock('@/lib/analytics/sentry', () => ({ captureError: vi.fn() }));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

const REGOLA_DI_PRIMA = /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g;
const GETTONE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwicm9sZSI6ImF1dGhlbnRpY2F0ZWQifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

let righe: string[] = [];
beforeEach(() => {
  righe = [];
  vi.resetModules();
  for (const livello of ['log', 'warn', 'error'] as const) {
    vi.spyOn(console, livello).mockImplementation((...a: unknown[]) => {
      righe.push(a.map(String).join(' '));
    });
  }
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function caricaLogger() {
  return (await import('@/lib/logger')).logger;
}

/** Il testo del messaggio come esce nella riga di log. */
function messaggioScritto(riga: string): string {
  return (JSON.parse(riga) as { msg: string }).msg;
}

/** Numeri a caso ma sempre gli stessi: un rosso si ripete uguale. */
function generatore(seme: number) {
  let s = seme >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('i gettoni nel testo del logger', () => {
  it('un gettone vero sparisce, il resto della frase resta', async () => {
    const logger = await caricaLogger();
    logger.warn(`accesso rifiutato per Bearer ${GETTONE} alle 10`);
    logger.warn(`url /callback#access_token=${GETTONE}&type=recovery`);
    logger.warn(`chiave-${GETTONE}.coda`);
    const [a, b, c] = righe.map(messaggioScritto);
    expect(a).toBe('accesso rifiutato per Bearer [redacted] alle 10');
    expect(b).toBe('url /callback#access_token=[redacted]&type=recovery');
    expect(c).toBe('chiave-[redacted].coda');
  });

  it('toglie esattamente quello che toglieva la regola di prima, su testi a caso', async () => {
    const logger = await caricaLogger();
    // Niente cifre né chiocciole: le altre regole (email, telefono, IBAN, codice fiscale) non scattano.
    const lettere = ['eyJ', 'eyJ', 'e', 'y', 'J', 'a', 'b', '-', '-', '.', '.', '_', ' ', '/'];
    const caso = generatore(27112026);
    for (let n = 0; n < 3000; n++) {
      let testo = '';
      const pezzi = 1 + Math.floor(caso() * 24);
      for (let k = 0; k < pezzi; k++) testo += lettere[Math.floor(caso() * lettere.length)];
      righe = [];
      logger.warn(testo);
      expect(messaggioScritto(righe[0]), JSON.stringify(testo)).toBe(testo.replace(REGOLA_DI_PRIMA, '[redacted]'));
    }
  });

  it('100 mila caratteri fatti di «eyJ-» ripetuto si filtrano in fretta', async () => {
    const logger = await caricaLogger();
    const ostili = ['eyJ-'.repeat(25_000), `eyJa.${'eyJ-'.repeat(25_000)}`, `${'eyJa.'.repeat(20_000)}x`, 'eyJ_'.repeat(25_000)];
    for (const testo of ostili) {
      const t0 = performance.now();
      logger.warn(testo);
      // La regola di prima ci metteva circa 3 secondi; il passaggio solo qualche millesimo.
      expect(performance.now() - t0, testo.slice(0, 12)).toBeLessThan(500);
    }
  });
});
