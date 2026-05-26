/**
 * Next.js instrumentation hook.
 *
 * Next 14 chiama register() una volta sola all'avvio del runtime (server o
 * edge), prima del primo request. Qui carichiamo le config Sentry corrette
 * in base al runtime.
 *
 * Setup richiesto in next.config.js:
 *   experimental: { instrumentationHook: true }   // Next 14
 *   (in Next 15+ e' attivo by default e non serve la flag)
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

/**
 * Hook richiesto da Sentry per catturare automaticamente errori
 * nelle React Server Components di Next 14.2+.
 */
export async function onRequestError(...args: Parameters<typeof import('@sentry/nextjs').captureRequestError>) {
  const { captureRequestError } = await import('@sentry/nextjs');
  captureRequestError(...args);
}
