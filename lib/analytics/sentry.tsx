'use client';

import { useEffect } from 'react';
import { readConsent } from '@/lib/consent';

/**
 * Sentry minimal wrapper — installazione lazy.
 *
 * Esperti consultati:
 * - SRE: "Sentry free tier: 5k errors/mese, 10k transactions. Sufficiente per MVP."
 * - Security Engineer: "DSN va in env NEXT_PUBLIC_SENTRY_DSN — è pubblica per design."
 * - Senior PM: "Senza Sentry vivi nell'ignoranza: quando un buyer ha un bug
 *   alle 23 del sabato, lo scopri il lunedì."
 *
 * Setup:
 *   1. https://sentry.io → New Project → Next.js
 *   2. Copia DSN (es. https://abc@o123.ingest.sentry.io/456)
 *   3. Aggiungi env Render: NEXT_PUBLIC_SENTRY_DSN=https://...
 *   4. Sentry inizializzato automaticamente al primo mount
 *
 * GDPR: replay e tracing si abilitano SOLO se l'utente ha dato consenso
 * analytics (categoria 'analytics' nel banner cookie). Il report degli
 * errori base (dsn + beforeSend scrub) non richiede consenso perché
 * non traccia sessioni né performance (necessary per sicurezza del sito).
 */

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;
let initialized = false;

function getAnalyticsConsent(): boolean {
  const consent = readConsent();
  return !!(consent?.analytics);
}

async function initSentry() {
  if (initialized || !DSN || typeof window === 'undefined') return;
  initialized = true;
  const Sentry = await import('@sentry/nextjs').catch(() => null);
  if (!Sentry) return;
  const analyticsConsent = getAnalyticsConsent();
  Sentry.init({
    dsn: DSN,
    tracesSampleRate: analyticsConsent ? 0.1 : 0,
    replaysSessionSampleRate: analyticsConsent ? 0.05 : 0,
    replaysOnErrorSampleRate: analyticsConsent ? 1.0 : 0,
    environment: process.env.NODE_ENV,
    // 🟡-11: non inviare PII di default (IP/cookie/header). Esplicito anche se è
    // il default dell'SDK, così non regredisce se cambia in futuro.
    sendDefaultPii: false,
    ignoreErrors: [
      // Errori "rumorosi" che non sono actionable
      'ResizeObserver loop limit exceeded',
      'Non-Error promise rejection captured',
      'AbortError',
      'NetworkError when attempting to fetch resource',
    ],
    beforeSend(event) {
      // 🟡-11: scrub difensivo di PII — cookie, header (Authorization), body e
      // identità utente (teniamo solo l'id per correlare, mai email/ip).
      if (event.request) {
        delete event.request.cookies;
        delete event.request.headers;
        delete (event.request as { data?: unknown }).data;
      }
      if (event.user) {
        delete event.user.email;
        delete event.user.ip_address;
        delete (event.user as { username?: unknown }).username;
      }
      return event;
    },
  });
}

export async function captureError(err: unknown, context?: Record<string, any>) {
  if (!DSN) {
    console.error('[error]', err, context);
    return;
  }
  const Sentry = await import('@sentry/nextjs').catch(() => null);
  if (!Sentry) return;
  Sentry.captureException(err, { extra: context });
}

export async function setSentryUser(userId: string, email?: string) {
  if (!DSN) return;
  const Sentry = await import('@sentry/nextjs').catch(() => null);
  if (!Sentry) return;
  // PII: NON inviamo l'email (dato personale) a Sentry, processore terzo —
  // coerente con sendDefaultPii:false lato server. Solo l'id per correlare gli
  // eventi. Il parametro `email` resta nella firma per compatibilità callsite.
  void email;
  Sentry.setUser({ id: userId });
}

export default function SentryProvider() {
  useEffect(() => {
    // GDPR gate: inizializza Sentry (incluso il report degli errori base) SOLO
    // dopo che l'utente ha dato consenso analytics. Prima del consenso nessun
    // dato viene inviato a Sentry, processore terzo (Art.28 GDPR).
    if (getAnalyticsConsent()) {
      initSentry();
    }

    // Catch unhandled promise rejections globally (solo se già inizializzato)
    const onUnhandled = (e: PromiseRejectionEvent) => captureError(e.reason, { type: 'unhandledrejection' });
    window.addEventListener('unhandledrejection', onUnhandled);

    // Quando l'utente cambia il consenso:
    // - se lo concede → inizializza Sentry (idempotente grazie al flag `initialized`)
    // - se lo revoca → aggiorna i sample rate a 0 sul client già vivo
    //   (Sentry.init() non può essere chiamato due volte; modifichiamo le opzioni live)
    const onConsentChange = async () => {
      const Sentry = await import('@sentry/nextjs').catch(() => null);
      if (!Sentry) return;
      const analyticsConsent = getAnalyticsConsent();
      if (analyticsConsent) {
        // Primo consenso: avvia Sentry (no-op se già inizializzato)
        initSentry();
        return;
      }
      // Consenso revocato: azzera replay e tracing sul client live
      const client = Sentry.getClient();
      if (!client) return;
      const opts = client.getOptions();
      opts.tracesSampleRate = 0;
      opts.replaysSessionSampleRate = 0;
      opts.replaysOnErrorSampleRate = 0;
    };
    window.addEventListener('mc:consent-change', onConsentChange);

    return () => {
      window.removeEventListener('unhandledrejection', onUnhandled);
      window.removeEventListener('mc:consent-change', onConsentChange);
    };
  }, []);
  return null;
}
