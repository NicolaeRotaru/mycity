/**
 * #236 — Il registratore degli errori si accende PRIMA del primo disegno.
 *
 * Next esegue questo file all'avvio del browser, prima che React monti
 * qualunque cosa. Fino a ieri l'accensione stava dentro un componente
 * (`SentryProvider`), quindi un errore che rompe l'applicazione mentre si
 * carica — il guasto peggiore, quello che lascia la pagina bianca — non veniva
 * registrato da nessuno: la registrazione partiva dopo.
 *
 * Senza il DSN configurato questo file non fa niente e non costa niente.
 */

import * as Sentry from '@sentry/nextjs';
import { opzioniSentry, SENTRY_DSN } from '@/lib/analytics/sentry-config';

if (SENTRY_DSN) {
  Sentry.init(opzioniSentry() as Parameters<typeof Sentry.init>[0]);
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
