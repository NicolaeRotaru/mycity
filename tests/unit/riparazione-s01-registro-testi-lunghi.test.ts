import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sentry = vi.hoisted(() => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock('@sentry/nextjs', () => sentry);
vi.mock('@/lib/analytics/sentry', () => ({ captureError: vi.fn() }));

import { logger } from '@/lib/logger';
import { runInNewContext } from 'node:vm';

const EMAIL = 'mario.rossi@example.com';
const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
const PEZZO_DEL_JWT = 'SflKxwRJSMeKKF2QT4fw';
const IBAN = 'IT60X0542811101000000123456';

let righe: string[] = [];
beforeEach(() => {
  righe = [];
  const prendi = (...a: unknown[]) => { righe.push(a.map(String).join(' ')); };
  vi.spyOn(console, 'log').mockImplementation(prendi);
  vi.spyOn(console, 'warn').mockImplementation(prendi);
  vi.spyOn(console, 'error').mockImplementation(prendi);
  sentry.captureException.mockClear();
  sentry.captureMessage.mockClear();
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', '');
  vi.stubEnv('SENTRY_DSN', '');
  vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const uscita = () => righe.join('\n');
const ultimaRiga = () => JSON.parse(righe[righe.length - 1]) as Record<string, unknown>;

function quantoCi(fai: () => unknown): number {
  const inizio = performance.now();
  fai();
  return performance.now() - inizio;
}

describe('S01 · il registro oscura i testi', () => {
  it('oscura email e JWT nel messaggio', () => {
    logger.warn(`accesso di ${EMAIL} con Bearer ${JWT}`);
    expect(uscita()).not.toContain(EMAIL);
    expect(uscita()).not.toContain(PEZZO_DEL_JWT);
    expect(ultimaRiga().msg).toBe('accesso di [redacted] con Bearer [redacted]');
  });

  it('oscura i testi del contesto, anche annidati e in un elenco', () => {
    logger.info('prova', {
      nota: `scrivi a ${EMAIL}`,
      dentro: { piu: { giu: `token=${JWT}` } },
      elenco: [EMAIL, `t:${JWT}`, 'resta'],
    });
    expect(uscita()).not.toContain(EMAIL);
    expect(uscita()).not.toContain(PEZZO_DEL_JWT);
    expect(ultimaRiga().elenco).toEqual(['[redacted]', 't:[redacted]', 'resta']);
  });

  it('oscura anche oltre la profondita’ massima', () => {
    logger.warn('prova', { a: { b: { c: { d: { e: { f: EMAIL, g: { email: 'anna@example.org' } } } } } } });
    expect(uscita()).not.toContain(EMAIL);
    expect(uscita()).not.toContain('anna@example.org');
  });

  it('oscura le chiavi sensibili fra apici dentro un testo', () => {
    logger.warn('risposta {"password":"segreta-uno","ok":true}', {
      corpo: "{'token': 'segreta-due', 'stato': 'pronto'}",
      altro: '{"accessToken": "segreta-tre"}',
    });
    expect(uscita()).not.toContain('segreta-');
    expect(uscita()).toContain('pronto');
    expect(ultimaRiga().msg).toBe('risposta {"password":"[redacted]","ok":true}');
  });

  it('oscura le chiavi in camelCase del contesto', () => {
    logger.warn('prova', { accessToken: 'valore-uno', clientSecret: 'valore-due' });
    expect(uscita()).not.toContain('valore-');
  });

  it('oscura l’IBAN, anche minuscolo o a gruppi', () => {
    logger.warn(`bonifico su ${IBAN.toLowerCase()}`, { nota: 'IBAN IT60 X054 2811 1010 0000 0123 456 grazie' });
    expect(uscita()).not.toContain(IBAN.toLowerCase());
    expect(uscita()).not.toContain('X054 2811');
    expect(ultimaRiga().nota).toBe('IBAN [redacted] grazie');
  });

  it('lascia stare coordinate, intervalli e orari', () => {
    const testo = 'posizione 45.0526, 9.6930; fascia 10-20; anni 2024-2025; orario 08:00-12:00; versione react@18.3.1';
    logger.warn(testo, { dove: '45.0526,9.6930', quando: '2024-2025' });
    expect(ultimaRiga()).toMatchObject({ msg: testo, dove: '45.0526,9.6930', quando: '2024-2025' });
  });

  it('a Sentry vanno errore, causa e contesto oscurati', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://chiave-finta@o1.ingest.sentry.io/1');
    const err = new Error(`pagamento di ${EMAIL} fallito`, { cause: new Error(`risposta con ${JWT}`) });
    logger.error(err, { nota: `cliente ${EMAIL}` });
    await vi.waitFor(() => expect(sentry.captureException).toHaveBeenCalledTimes(1));
    const [mandato, opzioni] = sentry.captureException.mock.calls[0] as [Error & { cause?: Error }, unknown];
    expect(mandato).toBeInstanceOf(Error);
    expect(mandato.message).toBe('pagamento di [redacted] fallito');
    expect(String(mandato.stack)).not.toContain(EMAIL);
    expect(mandato.cause).toBeInstanceOf(Error);
    expect(String(mandato.cause?.message)).not.toContain(PEZZO_DEL_JWT);
    expect(String(mandato.cause?.stack)).not.toContain(PEZZO_DEL_JWT);
    expect(JSON.stringify(opzioni)).not.toContain(EMAIL);
    expect(uscita()).not.toContain(EMAIL);
    // L'errore di chi chiama resta com'era.
    expect(err.message).toContain(EMAIL);
  });

  it('un testo lungo si taglia con un segno', () => {
    logger.warn('prova', { lungo: 'parola '.repeat(3_000) });
    const lungo = String(ultimaRiga().lungo);
    expect(lungo.length).toBeLessThan(9_000);
    expect(lungo).toContain('[troncato]');
  });

  it('oltre il tetto della chiamata il resto si tronca con un segno', () => {
    const pezzi = Array.from({ length: 1_000 }, (_, i) => `riga ${i} `.repeat(400));
    logger.warn('prova', { pezzi });
    expect(righe[0].length).toBeLessThan(150_000);
    expect(ultimaRiga().pezzi).toContain('[troncato]');
  });

  it('tempo lineare su testi lunghi', () => {
    vi.stubEnv('SENTRY_DSN', 'https://chiave-finta@o1.ingest.sentry.io/1');
    const pezzi = Array.from({ length: 1_000 }, () => 'eyJ-'.repeat(1_000));
    const lungo = 'a'.repeat(100_000 - 1) + '@';
    const ms1 = quantoCi(() => logger.warn('prova', { pezzi }));
    const ms2 = quantoCi(() => logger.error(new Error(lungo), { testo: lungo, elenco: [lungo] }));
    expect(ms1, `elenco: ${Math.round(ms1)} ms`).toBeLessThan(200);
    expect(ms2, `testo: ${Math.round(ms2)} ms`).toBeLessThan(200);
  }, 60_000);

  it('un message che non è un testo non fa lanciare', () => {
    const numero = new Error('x');
    (numero as unknown as { message: unknown }).message = 42;
    const oggetto = new Error('x');
    (oggetto as unknown as { message: unknown }).message = { email: EMAIL };
    expect(() => logger.error(numero)).not.toThrow();
    expect(ultimaRiga().msg).toBe('42');
    expect(() => logger.error(oggetto)).not.toThrow();
    expect(() => logger.warn('avviso', { errore: numero })).not.toThrow();
    expect(uscita()).not.toContain(EMAIL);
  });

  it('se pulire la voce lancia, esce una riga fissa senza il testo', () => {
    const scoppia = { get dettaglio(): string { throw new Error(`guasto ${EMAIL}`); } };
    expect(() => logger.warn(`avviso ${EMAIL}`, scoppia)).not.toThrow();
    expect(() => logger.error(new Error(`errore ${EMAIL}`), scoppia)).not.toThrow();
    expect(righe.length).toBe(2);
    expect(uscita()).not.toContain(EMAIL);
    expect(ultimaRiga().level).toBe('error');
  });

  it('un errore di un altro realm arriva a Sentry col suo messaggio oscurato', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://chiave-finta@o1.ingest.sentry.io/1');
    const err = runInNewContext(`new Error('pagamento di ${EMAIL} fallito')`) as Error;
    expect(err instanceof Error).toBe(false);
    logger.error(err);
    await vi.waitFor(() => expect(sentry.captureException).toHaveBeenCalledTimes(1));
    const [mandato] = sentry.captureException.mock.calls[0] as [{ message?: unknown; stack?: unknown }];
    expect(mandato.message).toBe('pagamento di [redacted] fallito');
    expect(typeof mandato.stack).toBe('string');
    expect(String(mandato.stack)).not.toContain(EMAIL);
    expect(ultimaRiga().msg).toBe('pagamento di [redacted] fallito');
    logger.warn('avviso', { errore: err });
    expect((ultimaRiga().errore as { message?: unknown }).message).toBe('pagamento di [redacted] fallito');
  });
});
