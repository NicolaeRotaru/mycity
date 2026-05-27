import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock sentry capture - factory self-contained per evitare hoisting issue
vi.mock('@/lib/analytics/sentry', () => ({
  captureError: vi.fn(),
}));

import { logger } from '@/lib/logger';
import { captureError } from '@/lib/analytics/sentry';
const captureMock = vi.mocked(captureError);

describe('logger', () => {
  let consoleSpy: { log: ReturnType<typeof vi.spyOn>; warn: ReturnType<typeof vi.spyOn>; error: ReturnType<typeof vi.spyOn> };
  let originalEnv: string | undefined;

  beforeEach(() => {
    consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };
    originalEnv = process.env.NODE_ENV;
    vi.clearAllMocks();
  });

  afterEach(() => {
    consoleSpy.log.mockRestore();
    consoleSpy.warn.mockRestore();
    consoleSpy.error.mockRestore();
    process.env.NODE_ENV = originalEnv;
  });

  describe('info', () => {
    it('logs to console in non-production', () => {
      process.env.NODE_ENV = 'development';
      logger.info('msg', { foo: 1 });
      expect(consoleSpy.log).toHaveBeenCalledWith('[info] msg', { foo: 1 });
    });

    it('is silent in production', () => {
      process.env.NODE_ENV = 'production';
      logger.info('msg');
      expect(consoleSpy.log).not.toHaveBeenCalled();
    });
  });

  describe('warn', () => {
    it('warns in development', () => {
      process.env.NODE_ENV = 'development';
      logger.warn('careful', { reason: 'slow' });
      expect(consoleSpy.warn).toHaveBeenCalledWith('[warn] careful', { reason: 'slow' });
    });
  });

  describe('error', () => {
    it('captures error to Sentry always', () => {
      process.env.NODE_ENV = 'production';
      const err = new Error('boom');
      logger.error(err, { userId: 'u1' });
      expect(captureMock).toHaveBeenCalledWith(err, { userId: 'u1' });
    });

    it('also logs to console in dev', () => {
      process.env.NODE_ENV = 'development';
      const err = new Error('boom');
      logger.error(err);
      expect(consoleSpy.error).toHaveBeenCalled();
      expect(captureMock).toHaveBeenCalledOnce();
    });

    it('handles string ctx by wrapping in { detail }', () => {
      logger.error(new Error('x'), 'extra context');
      expect(captureMock).toHaveBeenCalledWith(expect.any(Error), { detail: 'extra context' });
    });

    it('passes undefined ctx when none provided', () => {
      logger.error(new Error('x'));
      expect(captureMock).toHaveBeenCalledWith(expect.any(Error), undefined);
    });
  });
});
