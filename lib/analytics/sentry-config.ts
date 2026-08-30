/**
 * Le impostazioni del registratore degli errori, in un posto solo.
 *
 * #236 — L'accensione stava dentro un `useEffect` di un componente React
 * (SentryProvider), cioè partiva DOPO il primo disegno della pagina. Il guasto
 * peggiore — quello che rompe l'applicazione mentre si carica, prima che React
 * arrivi a montare qualcosa — succedeva sempre prima, e non veniva registrato
 * da nessuno. Il registratore era acceso per tutti gli errori tranne il tipo
 * che conta di più.
 *
 * Ora l'accensione vive in `instrumentation-client.ts`, che Next esegue prima
 * del primo disegno. Le impostazioni sono qui perché le usano tutti e due.
 */

import { hasConsent } from '@/lib/consent';
import { ambienteSentry } from './ambiente';

export const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

export function opzioniSentry() {
  // La registrazione dello schermo (session replay) resta legata al consenso:
  // è l'unica parte che riprende quello che la persona fa. Il resto — gli
  // errori — è interesse legittimo e non aspetta il banner.
  const analyticsOk = typeof window !== 'undefined' && hasConsent('analytics');
  return {
    dsn: SENTRY_DSN,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: analyticsOk ? 0.05 : 0,
    replaysOnErrorSampleRate: analyticsOk ? 1.0 : 0,
    // R187 — `NODE_ENV` su Vercel dice `production` anche per le anteprime.
    environment: ambienteSentry(),
    // 🟡-11: non inviare PII di default (IP/cookie/header). Esplicito anche se è
    // il default dell'SDK, così non regredisce se cambia in futuro.
    sendDefaultPii: false,
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'Non-Error promise rejection captured',
      'AbortError',
      'NetworkError when attempting to fetch resource',
    ],
    beforeSend(event: any): any {
      // 🟡-11: scrub difensivo di PII — cookie, header (Authorization), body e
      // identità utente (teniamo solo l'id per correlare, mai email/ip).
      if (event.request) {
        delete event.request.cookies;
        delete event.request.headers;
        delete event.request.data;
      }
      if (event.user) {
        delete event.user.email;
        delete event.user.ip_address;
        delete event.user.username;
      }
      return event;
    },
  };
}
