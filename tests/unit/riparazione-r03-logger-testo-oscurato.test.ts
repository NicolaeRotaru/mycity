/**
 * R03-021 — Il logger oscurava solo per NOME di chiave: `{ customer_email }` usciva oscurato, ma la
 * stessa email (o un gettone) scritta nel testo del messaggio, in un contesto passato come stringa
 * o nel valore di una chiave innocua arrivava intera sulla console e su Sentry. Qui console e
 * Sentry sono finti, e si guarda tutto quello che ricevono.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const finti = vi.hoisted(() => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  captureError: vi.fn(),
}));
vi.mock('@sentry/nextjs', () => ({ captureException: finti.captureException, captureMessage: finti.captureMessage }));
vi.mock('@/lib/analytics/sentry', () => ({ captureError: finti.captureError }));

const DSN = 'https://chiave@o1.ingest.sentry.io/1';
const EMAIL = 'maria.rossi@example.it';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJjbGllbnRlLTEifQ.firmaFintaDelGettone123';
const CHIAVE = 'sk_live_51AbCdEfGhIjKlMnOp';
const TELEFONO = '333 123 4567';
const IBAN = 'IT60X0542811101000000123456';

let scritto: string[] = [];
beforeEach(() => {
  vi.resetModules();
  scritto = [];
  for (const k of ['log', 'warn', 'error'] as const) {
    vi.spyOn(console, k).mockImplementation((...a: unknown[]) => { scritto.push(a.map(String).join(' ')); });
  }
  finti.captureException.mockClear();
  finti.captureMessage.mockClear();
  finti.captureError.mockClear();
  vi.stubEnv('SENTRY_DSN', DSN);
  vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', DSN);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** Tutto quello che è uscito: console e chiamate a Sentry. */
const uscita = () =>
  JSON.stringify([scritto, finti.captureException.mock.calls, finti.captureMessage.mock.calls, finti.captureError.mock.calls], (_k, v) =>
    v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : v,
  );

function nienteInChiaro(testo: string) {
  for (const segreto of [EMAIL, 'eyJhbGciOiJIUzI1NiJ9', CHIAVE, TELEFONO, IBAN]) {
    expect(testo, `«${segreto}» è uscito in chiaro`).not.toContain(segreto);
  }
}

describe('R03-021 — il logger oscura anche il testo, non solo le chiavi', () => {
  it('il testo del messaggio: email, gettone, chiave, telefono e IBAN non escono (console)', async () => {
    const { logger } = await import('@/lib/logger');
    logger.warn(`invio fallito a ${EMAIL} con Bearer ${JWT}, chiave ${CHIAVE}, tel. ${TELEFONO}, iban ${IBAN}`);
    expect(scritto.length).toBe(1);
    nienteInChiaro(uscita());
    expect(JSON.parse(scritto[0]).msg).toContain('invio fallito a');
  });

  it('un errore scritto come frase va a Sentry senza email né chiave', async () => {
    const { logger } = await import('@/lib/logger');
    logger.error(`rimborso fallito per ${EMAIL}: token=${CHIAVE}`);
    await vi.waitFor(() => expect(finti.captureException).toHaveBeenCalledTimes(1));
    nienteInChiaro(uscita());
    expect(String(finti.captureException.mock.calls[0][0])).toContain('rimborso fallito per');
  });

  it('un contesto passato come stringa non esce in chiaro (console e Sentry)', async () => {
    const { logger } = await import('@/lib/logger');
    logger.error(new Error('consegna non salvata'), `cliente ${EMAIL}, telefono ${TELEFONO}`);
    await vi.waitFor(() => expect(finti.captureException).toHaveBeenCalledTimes(1));
    nienteInChiaro(uscita());
    const [, opzioni] = finti.captureException.mock.calls[0] as [unknown, { extra: { detail: string } }];
    expect(opzioni.extra.detail).toContain('cliente');
  });

  it('il messaggio di un Error e il valore di una chiave innocua non escono in chiaro', async () => {
    const { logger } = await import('@/lib/logger');
    logger.error(new Error(`duplicate key: Key (email)=(${EMAIL}) already exists`), { motivo: `chiamata con Bearer ${JWT}` });
    await vi.waitFor(() => expect(finti.captureException).toHaveBeenCalledTimes(1));
    nienteInChiaro(uscita());
    const errore = finti.captureException.mock.calls[0][0] as Error;
    expect(errore).toBeInstanceOf(Error);
    expect(errore.message).toContain('duplicate key');
  });

  it('nel browser l’avviso va a Sentry senza l’email', async () => {
    vi.stubGlobal('window', {});
    const { logger } = await import('@/lib/logger');
    logger.warn(`carrello non sincronizzato per ${EMAIL}`);
    await vi.waitFor(() => expect(finti.captureMessage).toHaveBeenCalledTimes(1));
    nienteInChiaro(uscita());
    expect(String(finti.captureMessage.mock.calls[0][0])).toContain('carrello non sincronizzato per');
  });

  it('un messaggio normale resta com’è: id, importi, date e quantità', async () => {
    const { logger } = await import('@/lib/logger');
    const msg = 'Ordine 0f8c2a4e-1b2c-4d3e-8f90-123456789012 pronto: totale 42,50 €, 3 pezzi, consegna 2026-11-20 alle 18:30';
    const err = new Error('rimborso fallito: ordine 0f8c2a4e-1b2c-4d3e-8f90-123456789012');
    logger.warn(msg, { orderId: '0f8c2a4e-1b2c-4d3e-8f90-123456789012', totale: 4250, nota: 'secondo tentativo' });
    logger.error(err, { orderId: 'ord_1' });
    const riga = JSON.parse(scritto[0]);
    expect(riga.msg).toBe(msg);
    expect(riga).toMatchObject({ orderId: '0f8c2a4e-1b2c-4d3e-8f90-123456789012', totale: 4250, nota: 'secondo tentativo' });
    // Senza niente da togliere, a Sentry arriva lo stesso errore, non una copia.
    await vi.waitFor(() => expect(finti.captureException).toHaveBeenCalledWith(err, { extra: { orderId: 'ord_1' } }));
  });
});
