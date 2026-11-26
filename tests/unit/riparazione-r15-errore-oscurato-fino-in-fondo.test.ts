import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import vm from 'node:vm';
import { applyAggregateErrorsToEvent, createStackParser, exceptionFromError, nodeStackLineParser } from '@sentry/core';

/**
 * L'errore mandato a Sentry deve arrivare oscurato fino in fondo, cioè in tutto quello che Sentry
 * legge davvero: la causa, la causa della causa, gli errori dentro un AggregateError (fino a sei
 * eccezioni collegate). Leggere l'errore non deve far lanciare il logger, e un Error che viene da
 * un altro contesto JavaScript non deve diventare `{}`.
 *
 * Le eccezioni si costruiscono con le funzioni di @sentry/core che usa l'integrazione linkedErrors:
 * nessuna rete, Sentry è finto.
 */

vi.mock('@/lib/analytics/sentry', () => ({ captureError: vi.fn() }));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

import * as SentryNext from '@sentry/nextjs';

const EMAIL = 'mario.rossi@example.com';
const righe: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  righe.length = 0;
  for (const l of ['log', 'warn', 'error'] as const) {
    vi.spyOn(console, l).mockImplementation((...a: unknown[]) => {
      righe.push(a.map(String).join(' '));
    });
  }
  vi.stubEnv('SENTRY_DSN', 'https://x@o1.ingest.sentry.io/1');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** Le eccezioni che Sentry mette nell'evento (linkedErrors, limite predefinito 5). */
function comeLeVedeSentry(e: unknown): string[] {
  const parser = createStackParser(nodeStackLineParser());
  const evento = { exception: { values: [exceptionFromError(parser, e as Error)] } };
  applyAggregateErrorsToEvent(exceptionFromError, parser, 'cause', 5, evento as never, { originalException: e } as never);
  return evento.exception.values.map((v) => `${v.type}: ${v.value}`);
}

async function mandaASentry(e: unknown): Promise<unknown> {
  const { logger } = await import('@/lib/logger');
  expect(() => logger.error(e)).not.toThrow();
  await vi.waitFor(() => expect(vi.mocked(SentryNext.captureException)).toHaveBeenCalled());
  return vi.mocked(SentryNext.captureException).mock.calls[0][0];
}

describe('fino in fondo: niente valore originale oltre il limite', () => {
  it('controllo: senza logger, Sentry manda l’email', () => {
    expect(comeLeVedeSentry(new Error(EMAIL)).join('\n')).toContain(EMAIL);
  });

  it('un AggregateError con dentro un errore con quattro cause', async () => {
    let c: Error = new Error(`causa 4 ${EMAIL}`);
    for (let i = 3; i >= 1; i--) c = new Error(`causa ${i} ${EMAIL}`, { cause: c });
    const ag = new AggregateError([new Error(`x ${EMAIL}`, { cause: c })], 'tutte fallite');
    const viste = comeLeVedeSentry(await mandaASentry(ag));
    expect(viste.join('\n')).not.toContain(EMAIL);
    expect(viste.length).toBeGreaterThan(4);
    expect(viste.join('\n')).toContain('AggregateError: tutte fallite');
  });

  it('tre AggregateError annidati, l’ultimo errore con una causa', async () => {
    const x = new Error('x', { cause: new Error(`dentro ${EMAIL}`) });
    const ag = new AggregateError([new AggregateError([new AggregateError([x], 'a3')], 'a2')], 'a1');
    const viste = comeLeVedeSentry(await mandaASentry(ag));
    expect(viste.join('\n')).not.toContain(EMAIL);
    expect(viste.join('\n')).toContain('dentro [redacted]');
  });

  it('un AggregateError che contiene se stesso, e una causa che torna su se stessa', async () => {
    const ag = new AggregateError([], `se stesso ${EMAIL}`);
    (ag.errors as unknown[]).push(ag);
    expect(comeLeVedeSentry(await mandaASentry(ag)).join('\n')).not.toContain(EMAIL);

    vi.mocked(SentryNext.captureException).mockClear();
    const e = new Error(`circolare ${EMAIL}`) as Error & { cause?: unknown };
    e.cause = e;
    expect(comeLeVedeSentry(await mandaASentry(e)).join('\n')).not.toContain(EMAIL);
  });
});

describe('leggere l’errore non fa lanciare il logger', () => {
  it('una pila letta da un getter che lancia', async () => {
    const e = new Error(`pila ${EMAIL}`);
    Object.defineProperty(e, 'stack', { get() { throw new Error('pila illeggibile'); }, configurable: true });
    const spedito = (await mandaASentry(e)) as Error;
    expect(spedito.message).toContain('pila');
    expect(spedito.message).not.toContain(EMAIL);
  });

  it('un nome del prototipo che legge un campo privato', async () => {
    class ErrorePrivato extends Error {
      #nome = 'ErrorePrivato';
      get name(): string {
        return this.#nome;
      }
    }
    const spedito = (await mandaASentry(new ErrorePrivato(`privato ${EMAIL}`))) as Error;
    expect(spedito.name).toBe('ErrorePrivato');
    expect(spedito.message).not.toContain(EMAIL);
    expect(comeLeVedeSentry(spedito).join('\n')).toContain('ErrorePrivato: privato [redacted]');
  });
});

describe('un Error di un altro contesto JavaScript', () => {
  it('arriva a Sentry come errore, col messaggio oscurato, e la riga lo dice', async () => {
    const straniero = vm.runInNewContext(`new Error("rimborso fallito per ${EMAIL}")`);
    const spedito = (await mandaASentry(straniero)) as Error;
    expect(spedito).toBeInstanceOf(Error);
    expect(spedito.message).toContain('rimborso fallito');
    expect(spedito.message).not.toContain(EMAIL);
    expect(comeLeVedeSentry(spedito).join('\n')).toContain('Error: rimborso fallito per [redacted]');
    const riga = righe.join('\n');
    expect(riga).toContain('rimborso fallito');
    expect(riga).not.toContain('[object Object]');
    expect(riga).not.toContain(EMAIL);
  });
});
