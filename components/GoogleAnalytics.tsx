'use client';

import { useEffect, useState } from 'react';
import Script from 'next/script';
import { usePathname, useSearchParams } from 'next/navigation';
import { readConsent } from '@/lib/consent';
import { scriptDiAvvioGtag } from '@/lib/analytics/gtag-avvio';
import { chiaveDellaPaginaVista } from '@/lib/analytics/tracciamento';

const GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? '';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

/**
 * Wrapper Google Analytics 4 GDPR-compliant.
 *
 *  - Si carica SOLO se l'utente ha dato consenso alla categoria "analytics"
 *    (vedi lib/consent.ts). Se rifiutato o non ancora deciso, niente script.
 *  - Reagisce all'evento `mc:consent-change` (emesso da writeConsent): se
 *    l'utente accetta dopo aver rifiutato, lo script viene caricato al volo;
 *    se rifiuta dopo aver accettato, mandiamo a gtag il flag consent=denied
 *    (Google Consent Mode v2) e basta — niente reload pagina.
 *  - Tracking page_view automatico al cambio di route in Next App Router.
 *
 * Per attivarlo serve NEXT_PUBLIC_GA_MEASUREMENT_ID=G-XXXXXXXXXX.
 */
export default function GoogleAnalytics() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [analyticsOn, setAnalyticsOn] = useState(false);

  useEffect(() => {
    const sync = () => setAnalyticsOn(!!readConsent()?.analytics);
    sync();
    window.addEventListener('mc:consent-change', sync);
    return () => window.removeEventListener('mc:consent-change', sync);
  }, []);

  // Page view tracking
  //
  // 27/8/2026 (R171) — l'indirizzo intero, filtri compresi, faceva contare una pagina vista a ogni
  // tocco di filtro sulla pagina dei risultati. La chiave adesso tiene il percorso e la sola
  // ricerca, ed è la stessa che usa il beacon di attività.
  const paginaVista = chiaveDellaPaginaVista(pathname ?? '/', searchParams);
  useEffect(() => {
    if (!analyticsOn || !GA_ID || !window.gtag) return;
    window.gtag('event', 'page_view', {
      page_path: paginaVista,
      page_location: window.location.origin + paginaVista,
    });
  }, [paginaVista, analyticsOn]);

  // Consent Mode update quando consenso cambia
  useEffect(() => {
    if (!GA_ID || !window.gtag) return;
    window.gtag('consent', 'update', {
      analytics_storage: analyticsOn ? 'granted' : 'denied',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    });
  }, [analyticsOn]);

  if (!GA_ID) return null;

  return (
    <>
      {/* Consent Mode v2: parte sempre in DENIED, poi update via gtag. Qui dentro c'è anche la
          configurazione della proprietà: deve stare in coda PRIMA di qualunque evento, altrimenti
          la pagina d'ingresso si perde (vedi lib/analytics/gtag-avvio.ts). */}
      <Script id="ga-consent-default" strategy="beforeInteractive">
        {scriptDiAvvioGtag(GA_ID)}
      </Script>

      {analyticsOn && (
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
          strategy="afterInteractive"
        />
      )}
    </>
  );
}

/**
 * 22/8/2026 — QUI C'ERA UNA SECONDA PORTA VERSO GOOGLE ANALYTICS, SENZA
 * CANCELLO. L'HO TOLTA.
 *
 * Si chiamava `trackEvent` e diceva di essere «no-op se l'utente non ha dato
 * consenso». Non lo era. L'unico controllo che faceva era «esiste window.gtag?»
 * — e window.gtag esiste sempre, anche senza consenso, perche' lo definisce lo
 * script che gira per primo proprio per poter mandare il segnale di consenso.
 *
 * E' lo stesso identico difetto gia' corretto dentro `ga()` in
 * lib/analytics/events.ts, dove sta scritto che «gtag non e' presente» non era
 * un cancello vero.
 *
 * Non la chiamava nessuno: era solo esportata, in attesa che qualcuno la
 * trovasse. Chi ha bisogno di mandare un evento usa `ga()`, che il consenso lo
 * legge davvero. Due porte per la stessa cosa sono il modo in cui il difetto
 * torna.
 */
