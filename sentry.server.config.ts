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
import { ambienteSentry } from '@/lib/analytics/ambiente';
import { ripulisciEvento } from '@/lib/analytics/sentry-config';

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN;

if (DSN) {
  Sentry.init({
    dsn: DSN,
    // R187 — `NODE_ENV` su Vercel dice `production` anche per le anteprime.
    environment: ambienteSentry(),
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
      // 17/11/2026 (R32-025) — La pulizia dei dati personali valeva solo nel browser: qui
      // l'errore partiva con l'indirizzo intero (ricerca compresa) in `request.url`,
      // `query_string` e `contexts.nextjs.request_path`. Adesso è la stessa del browser.
      return ripulisciEvento(event);
    },
    // 17/11/2026 (R32-025) — Le misure del server (il 10% delle richieste) portavano
    // `url.full`, `http.target`, il `referer` e l'IP: stessa pulizia degli errori.
    beforeSendTransaction(event) {
      return ripulisciEvento(event);
    },
  });
}
