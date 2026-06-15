import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock sentry capture - factory self-contained per evitare hoisting issue
vi.mock('@/lib/analytics/sentry', () => ({
  captureError: vi.fn(),
}));
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}));

import { logger } from '@/lib/logger';
import { captureError } from '@/lib/analytics/sentry';
import * as SentryNext from '@sentry/nextjs';
const captureMock = vi.mocked(captureError);
const captureExceptionMock = vi.mocked(SentryNext.captureException);

function setNodeEnv(value: string) {
  vi.stubEnv('NODE_ENV', value);
}

describe('logger', () => {
  let consoleSpy: { log: ReturnType<typeof vi.spyOn>; warn: ReturnType<typeof vi.spyOn>; error: ReturnType<typeof vi.spyOn> };

  beforeEach(() => {
    consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };
    vi.clearAllMocks();
  });

  afterEach(() => {
    consoleSpy.log.mockRestore();
    consoleSpy.warn.mockRestore();
    consoleSpy.error.mockRestore();
    vi.unstubAllEnvs();
  });

  describe('info', () => {
    it('logs to console in non-production', () => {
      setNodeEnv('development');
      logger.info('msg', { foo: 1 });
      expect(consoleSpy.log).toHaveBeenCalledWith('[info] msg', { foo: 1 });
    });

    it('is silent in production', () => {
      setNodeEnv('production');
      logger.info('msg');
      expect(consoleSpy.log).not.toHaveBeenCalled();
    });
  });

  describe('warn', () => {
    it('warns in development', () => {
      setNodeEnv('development');
      logger.warn('careful', { reason: 'slow' });
      expect(consoleSpy.warn).toHaveBeenCalledWith('[warn] careful', { reason: 'slow' });
    });
  });

  // Server-side (test env = node): logger.error cattura direttamente sul SDK
  // server (@sentry/nextjs), NON sul wrapper 'use client'. DSN coerente col
  // server config (NEXT_PUBLIC_SENTRY_DSN o SENTRY_DSN).
  describe('error (cattura server-side)', () => {
    const DSN = 'https://x@o1.ingest.sentry.io/1';

    it('inoltra a Sentry con il ctx in extra (anche con solo SENTRY_DSN)', async () => {
      setNodeEnv('production');
      vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', '');
      vi.stubEnv('SENTRY_DSN', DSN);
      const err = new Error('boom');
      logger.error(err, { userId: 'u1' });
      await vi.waitFor(() =>
        expect(captureExceptionMock).toHaveBeenCalledWith(err, { extra: { userId: 'u1' } }),
      );
      // Server NON passa dal wrapper client.
      expect(captureMock).not.toHaveBeenCalled();
    });

    it('logga anche su console in dev', async () => {
      setNodeEnv('development');
      vi.stubEnv('SENTRY_DSN', DSN);
      logger.error(new Error('boom'));
      expect(consoleSpy.error).toHaveBeenCalled();
      await vi.waitFor(() => expect(captureExceptionMock).toHaveBeenCalledOnce());
    });

    it('normalizza ctx stringa in { detail } dentro extra', async () => {
      vi.stubEnv('SENTRY_DSN', DSN);
      logger.error(new Error('x'), 'extra context');
      await vi.waitFor(() =>
        expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
          extra: { detail: 'extra context' },
        }),
      );
    });

    it('passa extra undefined quando non c\'è ctx', async () => {
      vi.stubEnv('SENTRY_DSN', DSN);
      logger.error(new Error('x'));
      await vi.waitFor(() =>
        expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), undefined),
      );
    });

    it('no-op se nessun DSN configurato', async () => {
      vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', '');
      vi.stubEnv('SENTRY_DSN', '');
      logger.error(new Error('x'));
      await new Promise((r) => setTimeout(r, 20));
      expect(captureExceptionMock).not.toHaveBeenCalled();
    });
  });
});
