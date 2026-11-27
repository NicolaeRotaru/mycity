import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Il logger oscurava la frase e il contesto, ma un oggetto Error andava a Sentry così com'era
 * (`captureException(err)`): un'email o un telefono nel messaggio dell'errore uscivano in chiaro.
 * Qui si guarda quello che arriva davvero alla cattura: il messaggio, la testa della pila, la causa,
 * e l'errore del database che arriva come oggetto semplice. L'Error di chi chiama resta com'era.
 */

vi.mock('@/lib/analytics/sentry', () => ({ captureError: vi.fn() }));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

import * as SentryNext from '@sentry/nextjs';
import * as SentryBrowser from '@/lib/analytics/sentry';

const DSN = 'https://x@o1.ingest.sentry.io/1';
const EMAIL = 'mario.rossi@example.com';
const TELEFONO = '+39 333 1234567';
const MESSAGGIO = `fallito per ${EMAIL} ${TELEFONO}`;

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  for (const livello of ['log', 'warn', 'error'] as const) vi.spyOn(console, livello).mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function caricaLogger() {
  return (await import('@/lib/logger')).logger;
}

async function catturatoDalServer(): Promise<unknown> {
  await vi.waitFor(() => expect(vi.mocked(SentryNext.captureException)).toHaveBeenCalled());
  return vi.mocked(SentryNext.captureException).mock.calls[0][0];
}

function senzaDati(testo: string) {
  for (const dato of [EMAIL, TELEFONO, '333 1234567', '3331234567']) expect(testo, dato).not.toContain(dato);
}

describe('a Sentry il messaggio di un Error arriva oscurato', () => {
  it('IL CASO: new Error con email e telefono → né l’una né l’altro, il nome resta', async () => {
    vi.stubEnv('SENTRY_DSN', DSN);
    const logger = await caricaLogger();
    const err = new Error(MESSAGGIO);
    logger.error(err, { ordine: 'ord_1' });

    const spedito = (await catturatoDalServer()) as Error;
    expect(spedito).toBeInstanceOf(Error);
    expect(spedito.name).toBe('Error');
    senzaDati(spedito.message);
    expect(spedito.message).toContain('fallito per');
    expect(spedito.message).toContain('[redacted]');
    // La testa della pila ripete il messaggio: oscurata anche lì, le righe «at» restano.
    senzaDati(String(spedito.stack));
    expect(String(spedito.stack)).toMatch(/\n\s+at /);
    // L'errore di chi chiama non si tocca.
    expect(err.message).toBe(MESSAGGIO);
    expect(String(err.stack)).toContain(EMAIL);
  });

  it('con gli argomenti invertiti («frase», err) vale lo stesso', async () => {
    vi.stubEnv('SENTRY_DSN', DSN);
    const logger = await caricaLogger();
    logger.error('rimborso fallito', new Error(MESSAGGIO));
    const spedito = (await catturatoDalServer()) as Error;
    senzaDati(spedito.message);
    senzaDati(String(spedito.stack));
  });

  it('una sottoclasse con la causa: classe, nome e causa restano, i dati no', async () => {
    vi.stubEnv('SENTRY_DSN', DSN);
    class ErroreDelDatabase extends Error {
      codice = '23505';
      constructor(m: string, o?: { cause?: unknown }) {
        super(m, o);
        this.name = 'ErroreDelDatabase';
      }
    }
    const logger = await caricaLogger();
    logger.error(new ErroreDelDatabase(`duplicato: ${EMAIL}`, { cause: new Error(`richiamare ${TELEFONO}`) }));

    const spedito = (await catturatoDalServer()) as ErroreDelDatabase;
    expect(spedito).toBeInstanceOf(ErroreDelDatabase);
    expect(spedito.name).toBe('ErroreDelDatabase');
    expect(spedito.codice).toBe('23505');
    senzaDati(spedito.message);
    expect(spedito.cause).toBeInstanceOf(Error);
    senzaDati((spedito.cause as Error).message);
    expect((spedito.cause as Error).message).toContain('richiamare');
  });

  it('l’errore del database come oggetto semplice: il dettaglio con l’email non esce', async () => {
    vi.stubEnv('SENTRY_DSN', DSN);
    const logger = await caricaLogger();
    logger.error({ message: 'insert fallito', details: `Key (email)=(${EMAIL}) already exists.`, code: '23505' });
    const spedito = JSON.stringify(await catturatoDalServer());
    senzaDati(spedito);
    expect(spedito).toContain('23505');
    expect(spedito).toContain('insert fallito');
  });

  it('dal browser: anche l’errore passato al registratore del browser è oscurato', async () => {
    vi.stubGlobal('window', {});
    const logger = await caricaLogger();
    logger.error(new Error(MESSAGGIO));
    await vi.waitFor(() => expect(vi.mocked(SentryBrowser.captureError)).toHaveBeenCalled());
    const spedito = vi.mocked(SentryBrowser.captureError).mock.calls[0][0] as Error;
    expect(spedito.name).toBe('Error');
    senzaDati(spedito.message);
  });
});
