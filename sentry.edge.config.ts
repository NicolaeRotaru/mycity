/**
 * Sentry edge runtime init.
 *
 * Per middleware.ts e route handler con runtime='edge'.
 * In MyCity oggi tutti gli endpoint sono runtime='nodejs', ma il middleware
 * (auth + matcher) gira nell'edge: questo cattura errori li'.
 */

import * as Sentry from '@sentry/nextjs';
import { ambienteSentry } from '@/lib/analytics/ambiente';
import { ripulisciEvento } from '@/lib/analytics/sentry-config';

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN;

if (DSN) {
  Sentry.init({
    dsn: DSN,
    // R187 — `NODE_ENV` su Vercel dice `production` anche per le anteprime.
    environment: ambienteSentry(),
    tracesSampleRate: 0.05, // edge e' chiamato spessissimo, sample piu' basso
    ignoreErrors: [
      'AbortError',
      'NEXT_REDIRECT',
      'NEXT_NOT_FOUND',
    ],
    // 17/11/2026 (R32-025) — Qui (il middleware) errori e misure partivano senza nessuna
    // pulizia, con l'indirizzo intero della pagina: è la stessa del browser e del server.
    sendDefaultPii: false,
    beforeSend(event) {
      return ripulisciEvento(event);
    },
    beforeSendTransaction(event) {
      return ripulisciEvento(event);
    },
  });
}
