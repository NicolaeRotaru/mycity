import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * R10-008 — Il testo di un errore vero arrivava a Sentry senza oscurare i telefoni scritti in
 * forme di tutti i giorni: il fisso del negozio con la barra («0523/123456»), il prefisso fra
 * parentesi («(0523) 123456»), il link «tel:+39…» e il numero dentro un indirizzo codificato
 * («%20333…»). Qui si guarda quello che arriva davvero alla cattura di Sentry (server e browser) e
 * alla riga di log; date, ore, percorsi e indirizzi restano leggibili.
 */

vi.mock('@/lib/analytics/sentry', () => ({ captureError: vi.fn() }));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

import * as SentryNext from '@sentry/nextjs';
import * as SentryBrowser from '@/lib/analytics/sentry';

const DSN = 'https://x@o1.ingest.sentry.io/1';
const TELEFONI = [
  ['0523/123456', '0523123456'],
  ['(0523) 123456', '0523123456'],
  ['(333) 1234567', '3331234567'],
  ['333/1234567', '3331234567'],
  ['tel:+393331234567', '393331234567'],
  ['tel:3331234567', '3331234567'],
  ['Mario%20Rossi%203331234567', '3331234567'],
] as const;

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
  vi.unstubAllGlobals();
});

async function caricaLogger() {
  return (await import('@/lib/logger')).logger;
}

const soloCifre = (t: string) => t.replace(/\D/g, '');

describe('R10-008 · a Sentry il testo dell\'errore arriva senza telefoni, anche scritti come capita', () => {
  it.each(TELEFONI)('server: «%s» non esce né dal messaggio, né dalla pila, né dalla riga di log', async (scritto, cifre) => {
    vi.stubEnv('SENTRY_DSN', DSN);
    const logger = await caricaLogger();
    logger.error(new Error(`Negozio non raggiungibile, richiamare ${scritto} entro sera`), { ordine: 'ord_7' });
    await vi.waitFor(() => expect(vi.mocked(SentryNext.captureException)).toHaveBeenCalled());
    const spedito = vi.mocked(SentryNext.captureException).mock.calls[0][0] as Error;
    for (const testo of [spedito.message, String(spedito.stack), righe.join('\n')]) {
      expect(testo).toContain('[redacted]');
      expect(soloCifre(testo)).not.toContain(cifre);
    }
  });

  it('browser: la frase passata come errore a Sentry non porta il fisso con la barra', async () => {
    vi.stubGlobal('window', {});
    const logger = await caricaLogger();
    logger.error('Consegna rifiutata, chiamare il negozio allo 0523/123456');
    await vi.waitFor(() => expect(vi.mocked(SentryBrowser.captureError)).toHaveBeenCalled());
    const spedito = String(vi.mocked(SentryBrowser.captureError).mock.calls[0][0]);
    expect(spedito).toContain('[redacted]');
    expect(soloCifre(spedito)).not.toContain('0523123456');
  });

  it('date con la barra, ore, porte e percorsi restano leggibili', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const logger = await caricaLogger();
    const casi = [
      'consegna del 05/11/2026 alle 10:30',
      'scade il 05.11.2026',
      '/api/orders/0523123456/cod',
      'http://localhost:3000/seller',
      'ordine 20261124001234',
      'ts 1732449123456',
    ];
    for (const c of casi) logger.info(c);
    const tutto = righe.join('\n');
    for (const c of casi) expect(tutto, c).toContain(c);
  });
});
