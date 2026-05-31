'use client';

import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { readConsent } from '@/lib/consent';

/**
 * PostHog client wrapper.
 *
 * Esperti consultati:
 * - Data Analyst: "PostHog free fino 1M eventi/mese + session replay + funnel.
 *   Non si tocca un marketplace senza PostHog."
 * - Security Engineer: "Carica solo se NEXT_PUBLIC_POSTHOG_KEY è settata.
 *   Cookie consent rispettato via opt_in/opt_out."
 * - SRE: "Lazy import per non gonfiare bundle iniziale (PostHog ~50KB)."
 *
 * Setup:
 *   1. Crea account su https://eu.posthog.com (EU instance, GDPR-friendly)
 *   2. Copia Project API Key
 *   3. Aggiungi su Render env: NEXT_PUBLIC_POSTHOG_KEY=phc_xxx
 *   4. Aggiungi: NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com
 */

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://eu.i.posthog.com';

type PostHogLike = {
  capture: (event: string, props?: Record<string, unknown>) => void;
  identify: (userId: string, traits?: Record<string, unknown>) => void;
  reset: () => void;
  opt_in_capturing: () => void;
  opt_out_capturing: () => void;
};

let posthogInstance: PostHogLike | null = null;

async function getPosthog() {
  if (!POSTHOG_KEY) return null;
  if (typeof window === 'undefined') return null;
  // GDPR: nessun tracking analytics senza consenso esplicito dell'utente.
  // Fonte di verità unica: readConsent().analytics (lib/consent.ts). Se il
  // consenso cambia a runtime applichiamo opt-in/opt-out sull'istanza già
  // caricata, così una revoca ha effetto immediato senza reload.
  const consented = !!readConsent()?.analytics;
  if (posthogInstance) {
    try {
      if (consented) posthogInstance.opt_in_capturing();
      else posthogInstance.opt_out_capturing();
    } catch {}
    return consented ? posthogInstance : null;
  }
  if (!consented) return null;
  // Lazy import per non gonfiare bundle
  const { default: posthog } = await import('posthog-js').catch(() => ({ default: null }));
  if (!posthog) return null;
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    person_profiles: 'identified_only',
    capture_pageview: false, // gestiamo noi via useEffect
    capture_pageleave: true,
    session_recording: {
      maskAllInputs: true,
      maskInputOptions: { password: true, email: true },
    },
    autocapture: {
      dom_event_allowlist: ['click', 'submit'],
    },
  });
  posthogInstance = posthog;
  return posthog;
}

/**
 * Track event arbitrario. Es:
 *   track('product_viewed', { product_id, price, category });
 */
export async function track(event: string, properties?: Record<string, unknown>) {
  const ph = await getPosthog();
  if (!ph) return;
  ph.capture(event, properties);
}

/**
 * Identifica un utente (al signup/signin). Linka tutti gli eventi anonimi
 * precedenti al user_id.
 */
export async function identify(userId: string, traits?: Record<string, unknown>) {
  const ph = await getPosthog();
  if (!ph) return;
  ph.identify(userId, traits);
}

export async function resetUser() {
  const ph = await getPosthog();
  if (!ph) return;
  ph.reset();
}

/**
 * Mount component invisibile in app/layout.tsx. Track pageview ad ogni
 * navigazione client-side (Next.js router).
 */
export default function PostHogProvider() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Applica subito il consenso quando cambia (opt-in se accetta, opt-out se
  // revoca) senza aspettare la navigazione successiva.
  useEffect(() => {
    if (!POSTHOG_KEY) return;
    const onConsentChange = () => { void getPosthog(); };
    window.addEventListener('mc:consent-change', onConsentChange);
    return () => window.removeEventListener('mc:consent-change', onConsentChange);
  }, []);

  useEffect(() => {
    if (!POSTHOG_KEY) return;
    const url = pathname + (searchParams?.toString() ? `?${searchParams.toString()}` : '');
    getPosthog().then((ph) => {
      if (ph) ph.capture('$pageview', { $current_url: url });
    });
  }, [pathname, searchParams]);

  // Capture Web Vitals (Core Web Vitals: LCP, FID/INP, CLS)
  useEffect(() => {
    if (!POSTHOG_KEY) return;
    let cancelled = false;
    (async () => {
      const mod = await import('web-vitals').catch(() => null);
      if (!mod || cancelled) return;
      const sendVital = (name: string) => (metric: { value: number; rating: string }) => {
        track('web_vital', { metric: name, value: metric.value, rating: metric.rating });
      };
      mod.onCLS(sendVital('CLS'));
      mod.onLCP(sendVital('LCP'));
      mod.onINP(sendVital('INP'));
      mod.onFCP(sendVital('FCP'));
      mod.onTTFB(sendVital('TTFB'));
    })();
    return () => { cancelled = true; };
  }, []);

  return null;
}
