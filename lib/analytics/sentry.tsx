'use client';

import { useEffect } from 'react';
import { opzioniSentry, SENTRY_DSN } from '@/lib/analytics/sentry-config';

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
 *   4. L'accensione avviene in instrumentation-client.ts, prima del primo
 *      disegno di pagina (#236). Qui resta solo la rete di sicurezza.
 */

const DSN = SENTRY_DSN;
let initialized = false;

/**
 * #236 — Rete di sicurezza. L'accensione vera avviene in
 * `instrumentation-client.ts`, prima del primo disegno; questa resta per il
 * caso in cui quel file non sia stato eseguito (versioni diverse di Next,
 * ambienti di prova). `Sentry.init` chiamata due volte non fa danni: la
 * seconda sostituisce la configurazione della prima.
 */
async function initSentry() {
  if (initialized || !DSN || typeof window === 'undefined') return;
  initialized = true;
  const Sentry = await import('@sentry/nextjs').catch(() => null);
  if (!Sentry) return;
  if ((Sentry as { getClient?: () => unknown }).getClient?.()) return; // già acceso
  Sentry.init(opzioniSentry() as Parameters<typeof Sentry.init>[0]);
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
    initSentry();
    // Catch unhandled promise rejections globally
    const onUnhandled = (e: PromiseRejectionEvent) => captureError(e.reason, { type: 'unhandledrejection' });
    window.addEventListener('unhandledrejection', onUnhandled);
    return () => window.removeEventListener('unhandledrejection', onUnhandled);
  }, []);
  return null;
}
