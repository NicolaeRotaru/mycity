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

type LogContext = Record<string, unknown> | unknown;

function toCtx(ctx: unknown): Record<string, unknown> | undefined {
  if (ctx === undefined || ctx === null) return undefined;
  if (typeof ctx === 'string') return { detail: ctx };
  if (typeof ctx === 'object') return ctx as Record<string, unknown>;
  return { value: ctx };
}

export const logger = {
  info: (msg: string, ctx?: LogContext) => {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[info] ${msg}`, ctx ?? '');
    }
  },

  warn: (msg: string, ctx?: LogContext) => {
    if (typeof window !== 'undefined' || process.env.NODE_ENV !== 'production') {
      console.warn(`[warn] ${msg}`, ctx ?? '');
    }
  },

  error: (err: unknown, ctx?: LogContext) => {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[error]', err, ctx ?? '');
    }
    captureError(err, toCtx(ctx));
  },
};
