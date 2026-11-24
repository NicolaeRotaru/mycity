import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * R03-013 — IL LOGGER OSCURAVA SOLO LE CHIAVI DEL CONTESTO.
 *
 * Un contesto stringa diventava `{ detail }` senza essere guardato, e il testo del messaggio
 * arrivava com'era: `logger.warn('x', 'mario@x.it')` mandava l'indirizzo in chiaro nei log (e, nel
 * browser, a Sentry). Qui si guarda quello che esce davvero: la riga sulla console, la cattura
 * del server e l'avviso del browser.
 */

vi.mock('@/lib/analytics/sentry', () => ({ captureError: vi.fn() }));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

import * as SentryNext from '@sentry/nextjs';

const DSN = 'https://x@o1.ingest.sentry.io/1';
const EMAIL = 'mario.rossi@example.it';
const TELEFONO = '+39 333 1234567';
const IBAN = 'IT60X0542811101000000123456';

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

describe('R03-013 il logger oscura anche il testo', () => {
  it('IL CASO: logger.warn("x", "mario@…") non scrive l indirizzo', async () => {
    const logger = await caricaLogger();
    logger.warn('x', EMAIL);
    expect(righe.join('\n')).not.toContain(EMAIL);
    expect(righe.join('\n')).toContain('[redacted]');
  });

  it('il testo del messaggio: email, telefono e IBAN non escono', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const logger = await caricaLogger();
    logger.warn(`email a ${EMAIL} non partita`);
    logger.info(`richiamare ${TELEFONO}`);
    logger.spesa(`bonifico su ${IBAN}`);
    const tutto = righe.join('\n');
    for (const dato of [EMAIL, TELEFONO, '3331234567', IBAN]) expect(tutto, dato).not.toContain(dato);
    // Quello che non è un dato personale resta leggibile.
    expect(tutto).toContain('non partita');
    expect(tutto).toContain('richiamare');
  });

  it('un valore stringa del contesto con un nome di chiave innocuo', async () => {
    const logger = await caricaLogger();
    logger.warn('posta', { errore: `rifiutata per ${EMAIL}`, orderId: 'ord_1', quando: '2026-11-24T09:00:00.000Z' });
    const tutto = righe.join('\n');
    expect(tutto).not.toContain(EMAIL);
    expect(tutto).toContain('ord_1');
    expect(tutto, 'una data non è un numero di telefono').toContain('2026-11-24T09:00:00.000Z');
  });

  it('a Sentry, dal server: né la frase passata come errore né il contesto stringa', async () => {
    vi.stubEnv('SENTRY_DSN', DSN);
    const logger = await caricaLogger();
    logger.error(`rimborso a ${EMAIL} fallito`, `telefono ${TELEFONO}`);
    await vi.waitFor(() => expect(vi.mocked(SentryNext.captureException)).toHaveBeenCalled());
    const [errore, opzioni] = vi.mocked(SentryNext.captureException).mock.calls[0] as [unknown, { extra?: unknown } | undefined];
    const spedito = JSON.stringify([errore, opzioni]);
    expect(spedito).not.toContain(EMAIL);
    expect(spedito).not.toContain('3331234567');
    expect(spedito).toContain('rimborso a [redacted] fallito');
    expect(righe.join('\n')).not.toContain(EMAIL);
  });

  it('nel browser l avviso a Sentry non porta il dato, né nel messaggio né nel contesto', async () => {
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', DSN);
    vi.stubGlobal('window', {});
    const logger = await caricaLogger();
    logger.warn(`ciao ${EMAIL}`, EMAIL);
    await vi.waitFor(() => expect(vi.mocked(SentryNext.captureMessage)).toHaveBeenCalled());
    expect(JSON.stringify(vi.mocked(SentryNext.captureMessage).mock.calls)).not.toContain(EMAIL);
  });

  it('un identificativo non si scambia per un numero', async () => {
    const logger = await caricaLogger();
    logger.warn('ordine 11111111-1111-1111-1111-111111111111 fermo', { id: 'pi_3N123456789012345' });
    const tutto = righe.join('\n');
    expect(tutto).toContain('11111111-1111-1111-1111-111111111111');
    expect(tutto).toContain('pi_3N123456789012345');
  });
  it('R03-013 giro 13: timestamp, id, date e versioni restano leggibili', async () => {
    const logger = await caricaLogger();
    const casi = [
      'ts 1732449123456',
      'ordine 20261124001234',
      'importo 1250000000',
      '/api/orders/123456789/cod',
      '2026-11-24 12:30:00',
      'v 1.2.3.4.5.6.7.8.9.10',
    ];
    for (const c of casi) logger.info(c);
    const tutto = righe.join('\n');
    for (const c of casi) expect(tutto, c).toContain(c);
  });

  it('R03-013 giro 13: i telefoni nel testo restano oscurati', async () => {
    const logger = await caricaLogger();
    const tel = ['+39 333 123 4567', '3331234567', '333-123-4567', '0039 333 1234567', '06 1234 5678'];
    for (const t of tel) logger.info(`chiama ${t} ora`);
    const tutto = righe.join('\n');
    for (const t of tel) expect(tutto, t).not.toContain(t);
    expect(tutto).toContain('chiama [redacted] ora');
  });

  it('R03-013 giro 13: 100k caratteri di cifre e trattini si filtrano in fretta', async () => {
    const logger = await caricaLogger();
    const ostile = '3-0 1'.repeat(20000);
    const t0 = performance.now();
    logger.info(ostile);
    logger.info('1-'.repeat(50000));
    expect(performance.now() - t0).toBeLessThan(50);
  });
});
