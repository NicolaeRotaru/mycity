import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * R17-010 — Un Error vero va a Sentry con email e telefoni oscurati, nel messaggio e nella testa della
 * pila. L'email si oscurava già; i telefoni solo in due forme («333 123 4567», «3331234567»): scritti a
 * gruppi diversi — «333 12 34 567», «333 1234 567», il fisso del negozio «0523 12 34 56» — uscivano in
 * chiaro, nel messaggio dell'errore come nella riga di log. Qui si guarda quello che arriva davvero alla
 * cattura di Sentry e alla console; le date, gli id e gli importi restano leggibili.
 */

vi.mock('@/lib/analytics/sentry', () => ({ captureError: vi.fn() }));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

import * as SentryNext from '@sentry/nextjs';

const DSN = 'https://x@o1.ingest.sentry.io/1';
const EMAIL = 'anna.bianchi@example.it';
const TELEFONI = [
  '333 12 34 567',
  '333 1234 567',
  '+39 333 12 34 567',
  '333.12.34.567',
  '0523 12 34 56',
  '02 12 34 56 78',
  '06 123 45 678',
];

let righe: string[] = [];
beforeEach(() => {
  righe = [];
  vi.clearAllMocks();
  vi.resetModules();
  for (const livello of ['log', 'warn', 'error'] as const) {
    vi.spyOn(console, livello).mockImplementation((...a: unknown[]) => {
      righe.push(a.map(String).join(' '));
    });
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function caricaLogger() {
  return (await import('@/lib/logger')).logger;
}

/** Le cifre di un telefono, senza separatori: un dato non deve uscire nemmeno così. */
const cifre = (t: string) => t.replace(/\D/g, '');

describe('R17-010 · a Sentry un Error arriva senza email né telefoni, scritti come capita', () => {
  it.each(TELEFONI)('messaggio e testa della pila: «%s» non esce', async (telefono) => {
    vi.stubEnv('SENTRY_DSN', DSN);
    const logger = await caricaLogger();
    const err = new Error(`Key (email)=(${EMAIL}) already exists; richiamare ${telefono} per la consegna`);
    logger.error(err, { ordine: 'ord_7' });
    await vi.waitFor(() => expect(vi.mocked(SentryNext.captureException)).toHaveBeenCalled());
    const spedito = vi.mocked(SentryNext.captureException).mock.calls[0][0] as Error;
    expect(spedito).toBeInstanceOf(Error);
    for (const testo of [spedito.message, String(spedito.stack)]) {
      expect(testo).not.toContain(EMAIL);
      expect(testo, telefono).not.toContain(telefono);
      expect(testo.replace(/\D/g, ''), telefono).not.toContain(cifre(telefono).slice(-9));
      expect(testo).toContain('richiamare [redacted] per la consegna');
    }
    // Le righe «at …» della pila restano: a Sentry servono percorsi e numeri di riga.
    expect(String(spedito.stack)).toMatch(/\n\s+at /);
    // L'Error di chi chiama non si tocca.
    expect(err.message).toContain(telefono);
    // Nemmeno la riga di log lo scrive.
    expect(righe.join('\n'), telefono).not.toContain(telefono);
  });

  it('date, ore, id e importi restano leggibili accanto ai telefoni oscurati', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const logger = await caricaLogger();
    const casi = [
      'consegna del 05.11.2026 alle 10:30',
      'scade il 05-11-2026 10 pezzi',
      'ordine 20261124001234',
      'importo 1250000000',
      '/api/orders/0523123456/cod',
      'ts 1732449123456',
      '2026-11-24 12:30:00',
    ];
    for (const c of casi) logger.info(c);
    const tutto = righe.join('\n');
    for (const c of casi) expect(tutto, c).toContain(c);
  });

  it('il filtro resta veloce su un testo ostile di cifre e separatori', async () => {
    const logger = await caricaLogger();
    const t0 = performance.now();
    logger.info('3 1 '.repeat(25000));
    logger.info('0.1-'.repeat(25000));
    logger.info('333 12 '.repeat(15000));
    expect(performance.now() - t0).toBeLessThan(200);
  });
});
