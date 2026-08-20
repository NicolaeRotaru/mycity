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
 * Setup (account MyCity = US):
 *   1. Account su https://us.posthog.com
 *   2. Copia Project API Key (phc_…)
 *   3. Render env: NEXT_PUBLIC_POSTHOG_KEY=phc_xxx
 *   4. Render env: NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
 */

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';

// #227 — L'indirizzo che riceve gli eventi finisce sempre per `.i.posthog.com`.
// Con l'indirizzo del pannello al posto suo, gli eventi partono e non arrivano
// da nessuna parte: nessun errore, solo silenzio. Meglio una riga in console
// subito che un mese di numeri a zero.
if (typeof window !== 'undefined' && POSTHOG_KEY && !/\.i\.posthog\.com\/?$/.test(POSTHOG_HOST)) {
  console.warn(
    `[analytics] NEXT_PUBLIC_POSTHOG_HOST vale "${POSTHOG_HOST}": non e' un indirizzo di raccolta eventi (deve finire per .i.posthog.com). Gli eventi non arriveranno.`,
  );
}

type PostHogLike = {
  capture: (event: string, props?: Record<string, unknown>) => void;
  identify: (userId: string, traits?: Record<string, unknown>) => void;
  reset: () => void;
  opt_in_capturing: () => void;
  opt_out_capturing: () => void;
  /** Proprieta' appiccicate a TUTTI gli eventi successivi (super-property). */
  register: (props: Record<string, unknown>) => void;
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

/**
 * #215 — Attacca una proprieta' a tutti gli eventi successivi di questa
 * sessione. Serve al test A/B: senza questo la variante viveva su un evento
 * solo (l'esposizione) e non su quelli che contano — carrello, acquisto — e
 * quindi l'esperimento non era misurabile.
 */
export async function registraProprietaPersistenti(props: Record<string, unknown>) {
  const ph = await getPosthog();
  if (!ph) return;
  try { ph.register(props); } catch { /* telemetria best-effort */ }
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
    const onConsentChange = () => {
      void getPosthog().then((ph) => {
        if (!ph) return;
        // Emette la pagina CORRENTE appena arriva il consenso.
        //
        // Il difetto: qui si faceva solo `getPosthog()` — si accendeva la
        // raccolta e si aspettava. Ma l'effetto che registra la pagina dipende
        // da percorso e parametri, che dopo un clic sul banner non cambiano:
        // la prima pagina — quella da cui la persona è arrivata, cioè la piu'
        // importante per capire da dove viene il traffico — non veniva mai
        // registrata. Si vedeva la seconda.
        // #222 — Chi accetta i cookie mentre e' gia' entrato restava anonimo
        // fino al ricaricamento della pagina: l'identificazione avviene al
        // montaggio del profilo, che dopo un clic sul banner non si rimonta.
        // Risultato: gli eventi piu' interessanti — quelli subito dopo il
        // consenso — restavano staccati dalla persona.
        void (async () => {
          try {
            const { supabase } = await import('@/lib/supabase/client');
            const { data } = await supabase.auth.getUser();
            if (data.user?.id) ph.identify(data.user.id);
          } catch { /* niente identita': gli eventi restano anonimi */ }
        })();
        const url = window.location.pathname + window.location.search;
        ph.capture('$pageview', { $current_url: url });
      });
    };
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
