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

  it('limite di lunghezza del testo ripulito: 200 KB senza «@» si ripuliscono in meno di 200 ms', async () => {
    const { logger } = await import('@/lib/logger');
    const lungo = 'a1B2c3D4e5'.repeat(20_000); // 200 KB di lettere e cifre, nessuna «@», nessuno spazio
    const prima = performance.now();
    logger.warn(lungo, lungo);
    logger.error(new Error(lungo), { nota: lungo });
    const durata = performance.now() - prima;
    expect(durata).toBeLessThan(200);
    const riga = JSON.parse(scritto[0]);
    expect(riga.msg.startsWith('a1B2c3D4e5')).toBe(true);
    expect(riga.msg.endsWith('…[troncato]')).toBe(true);
    expect(riga.msg.length).toBeLessThan(10_000);
    expect(riga.detail.endsWith('…[troncato]')).toBe(true);
    await vi.waitFor(() => expect(finti.captureException).toHaveBeenCalledTimes(1));
    const [errore, opzioni] = finti.captureException.mock.calls[0] as [Error, { extra: { nota: string } }];
    expect(errore.message.endsWith('…[troncato]')).toBe(true);
    expect(errore.message.length).toBeLessThan(10_000);
    expect(opzioni.extra.nota.length).toBeLessThan(10_000);
  });

  it('il taglio non lascia mezza email in chiaro', async () => {
    const { logger } = await import('@/lib/logger');
    // L'email sta a cavallo del taglio: senza la parola intera non si riconoscerebbe più.
    const testo = 'x '.repeat(3_995) + `${EMAIL} ` + 'y '.repeat(5_000);
    logger.warn(testo);
    const msg: string = JSON.parse(scritto[0]).msg;
    expect(msg.endsWith('…[troncato]')).toBe(true);
    expect(msg).not.toContain('maria');
    expect(msg).not.toContain('example');
  });

  it('numeri d’ordine, importi, durate e timestamp escono identici', async () => {
    const { logger } = await import('@/lib/logger');
    const msg =
      'ordine #30012345 e #00012345678: 35000000 centesimi, durata 312345678 ns, lotto 312345678901, ' +
      'ts 1763650800008 e 1763650800016, µs 1763650800000009, ns 1763650800000000008, ' +
      'ORDINE AB12 CONFERMATO PER IL RITIRO, alle 18:30 del 20.11.2026, prezzo 314.15';
    const err = new Error(`rimborso fallito: ordine #30012345, 35000000 centesimi, ts 1763650800008`);
    logger.warn(msg, { ordine: '#30012345', quando: '1763650800008', nota: 'durata 312345678 ns' });
    logger.error(err, { orderId: 'ord_1' });
    const riga = JSON.parse(scritto[0]);
    expect(riga.msg).toBe(msg);
    expect(riga).toMatchObject({ ordine: '#30012345', quando: '1763650800008', nota: 'durata 312345678 ns' });
    // Senza niente da togliere, a Sentry arriva lo stesso errore, non una copia.
    await vi.waitFor(() => expect(finti.captureException).toHaveBeenCalledWith(err, { extra: { orderId: 'ord_1' } }));
  });

  it('email, telefoni veri, IBAN veri, carte vere e credenziali restano oscurati', async () => {
    const { logger } = await import('@/lib/logger');
    const veri = [
      EMAIL,
      '+39 333 123 4567',
      '+393331234567',
      '0039 02 1234 5678',
      '333-1234567',
      '3331234567',
      '(02) 12345678',
      '0532/123456',
      IBAN,
      'IT60 X054 2811 1010 0000 0123 456',
      'DE89370400440532013000',
      '4111 1111 1111 1111',
      '4242424242424242',
      '378282246310005',
      '5555-5555-5555-4444',
      'dXNlcjpwYXNzd29yZA==',
      'chiaveApi12345678',
      'gettoneCsrf12345678',
    ];
    logger.warn(
      `recapiti: ${veri.slice(0, 8).join(', ')}; conti: ${veri.slice(8, 11).join(', ')}; carte: ${veri.slice(11, 15).join(', ')}; ` +
        `Authorization: Basic ${veri[15]} x-api-key: ${veri[16]} csrf_token=${veri[17]}`,
      { 'x-api-key': 'chiaveApi12345678' },
    );
    // Un errore-oggetto semplice (come quelli di Supabase) va a Sentry ripulito anche lui.
    logger.error({ message: 'duplicate key', details: `Key (email)=(${EMAIL}) already exists`, code: '23505' });
    await vi.waitFor(() => expect(finti.captureException).toHaveBeenCalledTimes(1));
    const tutto = uscita();
    for (const v of veri) expect(tutto, `«${v}» è uscito in chiaro`).not.toContain(v);
    expect(JSON.parse(scritto[0]).msg).toContain('recapiti:');
    expect(finti.captureException.mock.calls[0][0]).toMatchObject({ message: 'duplicate key', code: '23505' });
  });

  it('il logger non lancia mai: messaggio che non è un testo, pila che non è un testo', async () => {
    const { logger } = await import('@/lib/logger');
    const pilaStrana = new Error('pila strana');
    Object.defineProperty(pilaStrana, 'stack', { value: 42, configurable: true });
    const messaggioStrano = new Error('x');
    Object.defineProperty(messaggioStrano, 'message', { value: { codice: 7 }, configurable: true });
    const circolare: Record<string, unknown> = {};
    circolare.a = { b: { c: { d: { e: { giro: circolare } } } } };

    expect(() => logger.warn(123 as unknown as string)).not.toThrow();
    expect(() => logger.warn(new Error('passato come messaggio') as unknown as string)).not.toThrow();
    expect(() => logger.warn(Object.create(null) as string)).not.toThrow();
    expect(() => logger.error(pilaStrana)).not.toThrow();
    expect(JSON.parse(scritto[0]).msg).toBe('123');
    expect(JSON.parse(scritto[1]).msg).toContain('passato come messaggio');
    expect(JSON.parse(scritto[3]).msg).toBe('pila strana');
    // L'errore con la pila strana arriva lo stesso a Sentry.
    await vi.waitFor(() => expect(finti.captureException).toHaveBeenCalledTimes(1));
    expect((finti.captureException.mock.calls[0][0] as Error).message).toBe('pila strana');

    expect(() => logger.warn('con pila strana', pilaStrana)).not.toThrow();
    expect(() => logger.error('frase prima', pilaStrana)).not.toThrow();
    expect(() => logger.error(messaggioStrano)).not.toThrow();
    expect(() => logger.info('contesto circolare', circolare)).not.toThrow();
    expect(() => logger.spesa('contesto con BigInt', { n: BigInt(1) })).not.toThrow();
    expect(scritto.length).toBe(9);
  });
});
