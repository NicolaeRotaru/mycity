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
  accendiSeSpento(Sentry);
}

type SdkSentry = typeof import('@sentry/nextjs');

/** Vero se il registratore ha un client acceso (senza, `captureException` butta l'evento in silenzio). */
function acceso(Sentry: SdkSentry): boolean {
  return Boolean((Sentry as { getClient?: () => unknown }).getClient?.());
}

/** Accende il registratore se nessuno l'ha ancora fatto. Vero se adesso è acceso. */
function accendiSeSpento(Sentry: SdkSentry): boolean {
  if (acceso(Sentry)) return true;
  try {
    Sentry.init(opzioniSentry() as Parameters<typeof Sentry.init>[0]);
  } catch {
    return false;
  }
  return acceso(Sentry);
}

/**
 * Manda l'errore al registratore. Risponde VERO solo se l'errore è arrivato a un registratore acceso:
 * è l'unico caso in cui una pagina può dire «abbiamo registrato il problema».
 *
 * 28/11/2026 (R08-002, onda 2) — L'ERRORE NEL TELEFONO CHE NON REGISTRAVA NESSUNO.
 *
 * Le pagine d'errore dicevano «Abbiamo registrato il problema» col solo DSN configurato. Ma l'accensione
 * (`instrumentation-client.ts`) parte quando il pezzo dell'SDK arriva dalla rete: su un telefono lento
 * l'errore che rompe la pagina mentre si carica arrivava qui PRIMA, e `captureException` senza un client
 * acceso restituisce un id e non spedisce niente. E se il pezzo dell'SDK non si scarica (rete che cade,
 * spesso la stessa che ha rotto la pagina), qui si usciva in silenzio. In tutti e due i casi la pagina
 * diceva il falso. Adesso, se il registratore non è ancora acceso, lo si accende qui prima di consegnare;
 * e chi chiama sa se la consegna c'è stata.
 */
export async function captureError(err: unknown, context?: Record<string, unknown>): Promise<boolean> {
  if (!DSN) {
    console.error('[error]', err, context);
    return false;
  }
  const Sentry = await import('@sentry/nextjs').catch(() => null);
  if (!Sentry) {
    console.error('[error] registratore non scaricato', err, context);
    return false;
  }
  if (!accendiSeSpento(Sentry)) {
    console.error('[error] registratore non acceso', err, context);
    return false;
  }
  Sentry.captureException(err, { extra: context });
  return true;
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
