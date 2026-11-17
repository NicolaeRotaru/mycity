// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Nel browser `logger.warn` era solo `console.warn`: ogni avviso scritto lato
 * client (tessere di categoria, rotta delle categorie in cache…) finiva nella
 * console del visitatore e non arrivava a nessuno. Adesso va anche al canale
 * che `logger.error` usa già lato client (Sentry), con il livello «warning».
 */

const sentry = vi.hoisted(() => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock('@sentry/nextjs', () => sentry);
vi.mock('@/lib/analytics/sentry', () => ({ captureError: vi.fn() }));

import { logger } from '@/lib/logger';

/** Un giro d'orologio: basta a far arrivare l'import chiesto a runtime. */
const unGiro = () => new Promise((r) => setTimeout(r, 0));

let avvisi: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  sentry.captureMessage.mockClear();
  sentry.captureException.mockClear();
  avvisi = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  avvisi.mockRestore();
  vi.unstubAllEnvs();
});

describe('gli avvisi scritti nel browser arrivano al registratore', () => {
  it('con il DSN, un avviso lato client va a Sentry col livello warning e il contesto ripulito', async () => {
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'https://chiave@o1.ingest.sentry.io/2');
    logger.warn('foto di categoria scartata', { categoria: 'pane', email: 'mario@example.com' });
    await unGiro();
    await unGiro();
    expect(avvisi).toHaveBeenCalledTimes(1);
    expect(sentry.captureMessage, 'l’avviso è rimasto nella console del visitatore').toHaveBeenCalledTimes(1);
    expect(sentry.captureMessage).toHaveBeenCalledWith('foto di categoria scartata', {
      level: 'warning',
      extra: { categoria: 'pane', email: '[redacted]' },
    });
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('senza DSN non parte niente verso Sentry, e la console resta', async () => {
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', '');
    logger.warn('avviso qualunque');
    await unGiro();
    await unGiro();
    expect(avvisi).toHaveBeenCalledTimes(1);
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });
});
