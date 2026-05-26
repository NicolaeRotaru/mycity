import { captureError } from '@/lib/analytics/sentry';

/**
 * Logger wrapper — strutturato, integrato con Sentry.
 *
 * Esperti consultati:
 * - SRE: "console.error in prod = perso. Routed via Sentry → tracking + alerting."
 * - Security Engineer: "Mai PII raw in log. Sanitize input prima."
 *
 * Uso:
 *   logger.info('Order placed', { orderId, total });
 *   logger.warn('Slow query', { duration });
 *   logger.error(err, { context: 'checkout-submit', userId });
 */

type LogContext = Record<string, unknown>;

export const logger = {
  info: (msg: string, ctx?: LogContext) => {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[info] ${msg}`, ctx ?? '');
    }
  },

  warn: (msg: string, ctx?: LogContext) => {
    // Sempre logged (warn potrebbe diventare error)
    if (typeof window !== 'undefined' || process.env.NODE_ENV !== 'production') {
      console.warn(`[warn] ${msg}`, ctx ?? '');
    }
  },

  error: (err: unknown, ctx?: LogContext) => {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[error]', err, ctx ?? '');
    }
    // Sempre capture in Sentry
    captureError(err, ctx);
  },
};
