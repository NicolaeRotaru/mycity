/**
 * Sentry server-side init.
 *
 * Caricato automaticamente da Next.js via instrumentation.ts.
 * Cattura errori da:
 *  - API routes (app/api/**)
 *  - Server Components / RSC
 *  - Server actions
 *
 * Se SENTRY_DSN non e' configurato, Sentry resta inattivo: zero overhead.
 */

import * as Sentry from '@sentry/nextjs';

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN;

if (DSN) {
  Sentry.init({
    dsn: DSN,
    environment: process.env.NODE_ENV,
    // Tracing campiona il 10% delle transazioni: bilancia visibilita' vs costo.
    tracesSampleRate: 0.1,
    // Server-side non ha sessioni utente: replay disabilitato.
    // ignoreErrors centralizzato per evitare rumore.
    ignoreErrors: [
      'AbortError',
      'NEXT_REDIRECT',
      'NEXT_NOT_FOUND',
    ],
    // Non inviare body request raw: puo' contenere PII (email, password,
    // token). Conserviamo solo path + method via Sentry default.
    sendDefaultPii: false,
    beforeSend(event, hint) {
      // Drop errori di rate limit (intenzionali, non bug)
      const msg = hint?.originalException?.toString() ?? '';
      if (msg.includes('rate limit') || msg.includes('Too Many Requests')) return null;
      return event;
    },
  });
}
