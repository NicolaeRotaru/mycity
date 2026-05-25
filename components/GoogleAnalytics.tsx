'use client';

import { useEffect, useState } from 'react';
import Script from 'next/script';
import { usePathname, useSearchParams } from 'next/navigation';
import { readConsent } from '@/lib/consent';

const GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? '';

declare global {
  interface Window {
    dataLayer?: any[];
    gtag?: (...args: any[]) => void;
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
  useEffect(() => {
    if (!analyticsOn || !GA_ID || !window.gtag) return;
    const url = pathname + (searchParams?.toString() ? `?${searchParams}` : '');
    window.gtag('event', 'page_view', {
      page_path: url,
      page_location: window.location.origin + url,
    });
  }, [pathname, searchParams, analyticsOn]);

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
      {/* Consent Mode v2: parte sempre in DENIED, poi update via gtag */}
      <Script id="ga-consent-default" strategy="beforeInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          window.gtag = gtag;
          gtag('consent', 'default', {
            analytics_storage: 'denied',
            ad_storage: 'denied',
            ad_user_data: 'denied',
            ad_personalization: 'denied',
            wait_for_update: 500
          });
        `}
      </Script>

      {analyticsOn && (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
            strategy="afterInteractive"
          />
          <Script id="ga-init" strategy="afterInteractive">
            {`
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              window.gtag = gtag;
              gtag('js', new Date());
              gtag('config', '${GA_ID}', {
                anonymize_ip: true,
                send_page_view: false
              });
            `}
          </Script>
        </>
      )}
    </>
  );
}

/**
 * Helper per tracciare eventi e-commerce. Chiamare da componenti client (es.
 * "Aggiungi al carrello", checkout, completed purchase). Se l'utente non ha
 * dato consenso, è no-op.
 */
export function trackEvent(name: string, params: Record<string, any> = {}) {
  if (typeof window === 'undefined' || !window.gtag) return;
  try {
    window.gtag('event', name, params);
  } catch { /* noop */ }
}
