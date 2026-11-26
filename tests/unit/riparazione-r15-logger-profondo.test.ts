import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Il logger non deve mai scrivere in chiaro quello che sta oltre il limite di profondità del filtro,
 * e non deve mai lanciare per un contesto che non si riesce a leggere.
 *
 * Oltre il limite il filtro restituiva l'oggetto originale: un contesto che tornava su se stesso
 * rimetteva nella riga, in chiaro, l'email e il telefono della radice (e lo stesso finiva
 * nell'extra di Sentry). Un getter che lancia nel contesto faceva lanciare il logger, e la riga
 * si perdeva.
 */

vi.mock('@/lib/analytics/sentry', () => ({ captureError: vi.fn() }));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

import * as SentryNext from '@sentry/nextjs';

const EMAIL = 'mario.rossi@example.com';
const TELEFONO = '3331234567';

const righe: Record<'log' | 'warn' | 'error', string[]> = { log: [], warn: [], error: [] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  for (const livello of ['log', 'warn', 'error'] as const) {
    righe[livello] = [];
    vi.spyOn(console, livello).mockImplementation((...a: unknown[]) => {
      righe[livello].push(a.map(String).join(' '));
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

/** Un contesto con i dati in cima, che torna su se stesso sei livelli più giù. */
function contestoCheTorna(): Record<string, unknown> {
  const ctx: Record<string, unknown> = { email: EMAIL, telefono_cliente: TELEFONO, ordine: 'ord_1' };
  const e: Record<string, unknown> = {};
  ctx.a = { b: { c: { d: { e } } } };
  e.torna = ctx;
  return ctx;
}

describe('oltre il limite di profondità non esce niente in chiaro', () => {
  it('IL CASO: un contesto che torna su se stesso non riscrive email e telefono della radice', async () => {
    const logger = await caricaLogger();
    expect(() => logger.info('giro', contestoCheTorna())).not.toThrow();
    expect(righe.log).toHaveLength(1);
    const riga = righe.log[0];
    expect(riga).not.toContain(EMAIL);
    expect(riga).not.toContain(TELEFONO);
    expect(riga).toContain('ord_1');
  });

  it('anche nel ramo degli errori: né la riga né l’extra di Sentry', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://x@o1.ingest.sentry.io/1');
    const logger = await caricaLogger();
    expect(() => logger.error(new Error('boom'), contestoCheTorna())).not.toThrow();
    expect(righe.error).toHaveLength(1);
    expect(righe.error[0]).not.toContain(EMAIL);
    await vi.waitFor(() => expect(vi.mocked(SentryNext.captureException)).toHaveBeenCalled());
    const spedito = JSON.stringify(vi.mocked(SentryNext.captureException).mock.calls[0][1]);
    expect(spedito).not.toContain(EMAIL);
    expect(spedito).not.toContain(TELEFONO);
  });

  it('un dato in fondo a un contesto molto annidato non esce', async () => {
    const logger = await caricaLogger();
    logger.info('giro', { a: { b: { c: { d: { e: { email: EMAIL, nota: `chiamare ${TELEFONO}` } } } } } });
    expect(righe.log[0]).not.toContain(EMAIL);
    expect(righe.log[0]).not.toContain(TELEFONO);
  });

  it('lo stesso oggetto ripetuto in profondità non diventa «[circolare]»', async () => {
    const logger = await caricaLogger();
    const c = { id: 'c1' };
    logger.info('giro', { a: { b: { c: { d: { x: c, y: c } } } } });
    expect(righe.log[0]).not.toContain('[circolare]');
  });
});

describe('un contesto che non si riesce a leggere non fa lanciare il logger', () => {
  const conGetterRotto = () => ({
    ordine: 'ord_1',
    get rotto(): unknown {
      throw new Error('getter');
    },
  });

  it('info: la riga esce, con quello che si legge', async () => {
    const logger = await caricaLogger();
    expect(() => logger.info('giro', conGetterRotto())).not.toThrow();
    expect(righe.log).toHaveLength(1);
    expect(righe.log[0]).toContain('giro');
    expect(righe.log[0]).toContain('ord_1');
  });

  it('warn ed error: nessuno lancia, la riga esce', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://x@o1.ingest.sentry.io/1');
    const logger = await caricaLogger();
    expect(() => logger.warn('attenzione', conGetterRotto())).not.toThrow();
    expect(() => logger.error(new Error('boom'), conGetterRotto())).not.toThrow();
    expect(righe.warn).toHaveLength(1);
    expect(righe.error).toHaveLength(1);
  });
});
