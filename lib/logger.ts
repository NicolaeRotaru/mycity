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

/**
 * Cattura server-side affidabile per gli errori di API/cron/webhook.
 *
 * Usa il SDK @sentry/nextjs già inizializzato da sentry.server.config.ts (via
 * instrumentation), con rilevamento DSN COERENTE col server (NEXT_PUBLIC_SENTRY_DSN
 * *o* SENTRY_DSN). Non passa dal wrapper `'use client'` (lib/analytics/sentry):
 * così un errore notturno del cron release-payouts o del webhook Stripe non viene
 * perso silenziosamente solo perché in prod è configurato SENTRY_DSN e non quello
 * pubblico. (Invariante: "si misura" — i fallimenti di soldi/consegna sono visibili.)
 */
async function captureServerError(err: unknown, ctx?: Record<string, unknown>): Promise<void> {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN;
  if (!dsn) return;
  const Sentry = await import('@sentry/nextjs').catch(() => null);
  Sentry?.captureException(err, ctx ? { extra: ctx } : undefined);
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
    const c = toCtx(ctx);
    if (typeof window === 'undefined') {
      // Server (API/cron/webhook): cattura diretta sul SDK server già init'd.
      void captureServerError(err, c);
    } else {
      // Client: wrapper lazy esistente (init Sentry browser al primo errore).
      void captureError(err, c);
    }
  },
};
