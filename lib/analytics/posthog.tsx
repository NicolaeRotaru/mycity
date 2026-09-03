'use client';

import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { readConsent } from '@/lib/consent';
import type { CaptureResult } from 'posthog-js';
import {
  indirizzoSenzaDatiPersonali,
  VALORE_NASCOSTO,
} from '@/lib/analytics/indirizzo-senza-dati-personali';

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
 *   3. Vercel → Settings → Environment Variables: NEXT_PUBLIC_POSTHOG_KEY=phc_xxx
 *   4. Vercel → Settings → Environment Variables: NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
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
  /** Comandi della telecamera: possono mancare su versioni vecchie. */
  startSessionRecording?: () => void;
  stopSessionRecording?: () => void;
};

/**
 * 27/8/2026 (R055) — LE PAGINE DOVE LA TELECAMERA NON DEVE GIRARE.
 *
 * La registrazione della sessione fa un filmato di quello che appare sullo
 * schermo. Su queste pagine, sullo schermo ci sono i dati di ALTRE persone:
 * negli ordini del negozio ci sono nome, telefono e indirizzo di chi ha
 * comprato; nell'amministrazione c'e' l'elenco degli utenti; nei messaggi c'e'
 * quello che si sono scritti in due.
 *
 * Il consenso ai cookie lo ha dato il negoziante o l'amministratore. Il cliente
 * che compare sul loro schermo non lo ha dato a nessuno, e non sa nemmeno che
 * esista un filmato: e' un trasferimento dei suoi dati fuori dall'Unione senza
 * base giuridica e senza informativa. E' anche l'unico punto in cui indirizzi e
 * numeri di telefono escono dal database e finiscono in un video su un servizio
 * di un altro.
 *
 * Sono percorsi INTERI, confrontati per segmento: «/sellers-del-mese» non e'
 * «/seller».
 */
export const PAGINE_CON_DATI_DI_TERZI = [
  '/admin',
  '/seller',
  '/rider',
  '/orders',
  '/checkout',
  '/profile',
  '/messages',
  '/returns',
] as const;

/** Si puo' filmare questa pagina senza riprendere i dati di qualcun altro? */
export function laPaginaSiPuoFilmare(pathname: string | null | undefined): boolean {
  if (!pathname) return true;
  const percorso = pathname.split('?')[0];
  return !PAGINE_CON_DATI_DI_TERZI.some(
    (p) => percorso === p || percorso.startsWith(`${p}/`),
  );
}

/**
 * Come si registra lo schermo.
 *
 * Prima c'erano i soli `maskAllInputs` + `maskInputOptions`: mascherano quello
 * che la persona STA SCRIVENDO, non quello che e' gia' scritto nella pagina. E
 * i dati dei clienti nella pagina di un negoziante non li scrive nessuno: ci
 * sono gia'. `maskTextSelector: '*'` copre ogni testo della pagina.
 */
export function opzioniRegistrazioneSchermo() {
  return {
    maskAllInputs: true,
    maskInputOptions: { password: true, email: true },
    maskTextSelector: '*',
  } as const;
}

/** Spegne la telecamera sulle pagine con dati di terzi, la riaccende altrove. */
export function applicaRegistrazioneSchermo(ph: PostHogLike, pathname: string | null | undefined): void {
  try {
    if (laPaginaSiPuoFilmare(pathname)) ph.startSessionRecording?.();
    else ph.stopSessionRecording?.();
  } catch {
    // La telemetria non deve mai far cadere una pagina.
  }
}

/**
 * 3/9/2026 — QUI L'INDIRIZZO DELLA PAGINA LO COMPILAVA LA LIBRERIA, DA
 * `window.location.href`, CON DENTRO LA RICERCA.
 *
 * `ph.capture('$pageview')` non passa `$current_url`: è una scelta scritta e
 * motivata più sotto (senza, dominio, pagina d'ingresso e pagina d'uscita
 * uscivano monchi). Solo che quando lo compila la libreria ci mette l'indirizzo
 * INTERO — «/search?q=ordine di mario.rossi@gmail.com» — e quello parte verso
 * un servizio che sta negli Stati Uniti.
 *
 * La regola non si riscrive qui: è la stessa che usano il beacon delle visite e
 * il registratore degli errori (`indirizzoSenzaDatiPersonali`). Questa funzione
 * la applica a ogni proprietà che contiene un indirizzo, compreso quello che
 * PostHog si porta dietro come proprietà della persona (`$set`, `$set_once`).
 *
 * Va agganciata a `before_send` in `init`, che PostHog chiama su OGNI evento
 * appena prima di spedirlo: così non c'è un evento da ricordarsi di ripulire a
 * mano, nemmeno quelli che manda la libreria per conto suo.
 *
 * ⚠️ Non `sanitize_properties`: nella versione installata è deprecata e stampa
 * un errore in console a OGNI evento («sanitize_properties is deprecated. Use
 * before_send instead»). Funziona ancora, ma riempirebbe la console di rumore.
 */
const PROPRIETA_CHE_SONO_INDIRIZZI = [
  '$current_url',
  '$referrer',
  '$pathname',
  '$initial_current_url',
  '$initial_referrer',
  '$initial_pathname',
  '$session_entry_url',
  '$session_entry_referrer',
  '$session_entry_pathname',
] as const;

function indirizzoRipulito(valore: unknown): unknown {
  if (typeof valore !== 'string' || !valore) return valore;
  // `$direct`, `$organic`… non sono indirizzi: sono i segnaposti di PostHog.
  if (valore.startsWith('$')) return valore;
  return indirizzoSenzaDatiPersonali(valore) ?? VALORE_NASCOSTO;
}

export function proprietaSenzaDatiPersonali(
  proprieta: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!proprieta || typeof proprieta !== 'object') return {};
  const pulite: Record<string, unknown> = { ...proprieta };
  for (const nome of PROPRIETA_CHE_SONO_INDIRIZZI) {
    if (nome in pulite) pulite[nome] = indirizzoRipulito(pulite[nome]);
  }
  // Le stesse chiavi viaggiano anche dentro le proprietà della persona.
  for (const contenitore of ['$set', '$set_once'] as const) {
    const dentro = pulite[contenitore];
    if (!dentro || typeof dentro !== 'object' || Array.isArray(dentro)) continue;
    const copia: Record<string, unknown> = { ...(dentro as Record<string, unknown>) };
    for (const nome of PROPRIETA_CHE_SONO_INDIRIZZI) {
      if (nome in copia) copia[nome] = indirizzoRipulito(copia[nome]);
    }
    pulite[contenitore] = copia;
  }
  return pulite;
}

/**
 * Il cancello sul DATO: ogni evento passa di qui prima di partire, compresi
 * quelli che la libreria manda da sola (pageleave, autocapture, telecamera).
 * Non lancia mai: la telemetria non deve poter rompere una pagina.
 */
export function eventoSenzaDatiPersonali(evento: CaptureResult | null): CaptureResult | null {
  if (!evento) return evento;
  try {
    if (evento.properties) evento.properties = proprietaSenzaDatiPersonali(evento.properties);
    if (evento.$set) evento.$set = proprietaSenzaDatiPersonali(evento.$set);
    if (evento.$set_once) evento.$set_once = proprietaSenzaDatiPersonali(evento.$set_once);
  } catch {
    /* meglio l'evento com'era che una pagina caduta */
  }
  return evento;
}

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
    // Il cancello sul DATO: ogni evento passa di qui prima di partire.
    before_send: eventoSenzaDatiPersonali,
    session_recording: opzioniRegistrazioneSchermo(),
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
        // 22/8/2026 — `$current_url` E' UN CAMPO RISERVATO E VUOLE L'INDIRIZZO
        // INTERO. Qui si passava solo il percorso («/product/123»), e PostHog
        // ci costruisce sopra dominio, pagina di ingresso e pagina di uscita:
        // su ogni singola visita quei campi erano monchi, e ogni analisi di
        // percorso — da dove entrano, dove escono — leggeva un indirizzo che
        // non esiste. Senza passarlo, la libreria lo compila da sola e giusto.
        // 27/8/2026 (R055) — chi accetta i cookie stando gia' dentro una pagina
        // con dati di altri (un negoziante sui suoi ordini) accendeva la
        // telecamera proprio li'. La pagina corrente si legge dal browser: la
        // variabile di questo effetto e' ferma al primo montaggio.
        applicaRegistrazioneSchermo(ph, window.location.pathname);
        ph.capture('$pageview');
      });
    };
    window.addEventListener('mc:consent-change', onConsentChange);
    return () => window.removeEventListener('mc:consent-change', onConsentChange);
  }, []);

  useEffect(() => {
    if (!POSTHOG_KEY) return;
    // Il percorso serve solo a far scattare l'effetto al cambio pagina: non si
    // passa a mano, per la ragione scritta qui sopra.
    getPosthog().then((ph) => {
      if (!ph) return;
      // 27/8/2026 (R055) — prima di registrare qualsiasi cosa, decidi se questa
      // pagina si puo' filmare. La decisione va presa a ogni navigazione: si
      // entra negli ordini del negozio da un link, non ricaricando il sito.
      applicaRegistrazioneSchermo(ph, pathname);
      ph.capture('$pageview');
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
