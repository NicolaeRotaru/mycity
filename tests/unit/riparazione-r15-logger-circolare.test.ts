import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '@/lib/logger';

describe('il logger non perde la riga con un contesto circolare', () => {
  afterEach(() => vi.restoreAllMocks());

  it('info con un oggetto che contiene se stesso scrive una riga', () => {
    const spia = vi.spyOn(console, 'log').mockImplementation(() => {});
    const ctx: Record<string, unknown> = { orderId: 'o1' };
    ctx.self = ctx;
    expect(() => logger.info('giro', ctx)).not.toThrow();
    expect(spia).toHaveBeenCalledTimes(1);
    const riga = String(spia.mock.calls[0][0]);
    expect(riga).toContain('giro');
    expect(riga).toContain('o1');
  });

  it('error con un contesto circolare non lancia e scrive la riga', () => {
    const spia = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ctx: Record<string, unknown> = { a: { b: {} } };
    (ctx.a as { b: Record<string, unknown> }).b.torna = ctx;
    expect(() => logger.error(new Error('boom'), ctx)).not.toThrow();
    expect(spia).toHaveBeenCalledTimes(1);
  });

  it('un contesto normale resta com\'era', () => {
    const spia = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('ok', { n: 1, email: 'a@b.it' });
    const j = JSON.parse(String(spia.mock.calls[0][0]));
    expect(j).toMatchObject({ level: 'info', msg: 'ok', n: 1, email: '[redacted]' });
  });
});
