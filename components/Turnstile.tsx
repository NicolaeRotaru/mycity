'use client';

import { forwardRef, useImperativeHandle, useEffect, useRef } from 'react';

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, any>) => string;
      remove: (widgetId: string) => void;
      reset: (widgetId: string) => void;
    };
    __turnstileLoaded?: boolean;
  }
}

type Props = {
  siteKey: string;
  onVerify: (token: string) => void;
  onExpire?: () => void;
  /**
   * #115 — Chiamata quando il controllo anti-bot NON si carica: rete che
   * blocca challenges.cloudflare.com (uffici, scuole, alcuni operatori),
   * estensione che lo taglia via, Cloudflare che ha un guasto. Prima non
   * esisteva: il gettone non arrivava mai, il modulo restava bloccato per
   * sempre e l'unico messaggio era «Completa il controllo anti-bot» — su un
   * riquadro vuoto. Nessuno poteva piu' registrarsi ne' accedere, e a noi non
   * arrivava nessun segnale.
   */
  onError?: (motivo: string) => void;
  theme?: 'light' | 'dark' | 'auto';
};

/**
 * Widget Cloudflare Turnstile. Carica lo script una sola volta in pagina
 * e renderizza un challenge invisibile/managed. Se la sitekey non è
 * configurata (lato server) il componente non viene montato dal parent.
 */
/**
 * 22/8/2026 — IL GETTONE SI CONSUMA AL PRIMO TENTATIVO, E NON SI RIGENERAVA.
 *
 * Cloudflare da' un gettone valido UNA volta. Se chi entra sbaglia la password,
 * il gettone e' gia' stato speso: al secondo tentativo il server lo rifiuta, e
 * il messaggio che arriva parla di anti-bot su una schermata dove non c'e'
 * niente da ripremere. La persona resta fuori dal proprio account per un errore
 * di battitura.
 *
 * `reset()` chiede a Cloudflare un gettone nuovo. Il riquadro lo espone verso
 * l'alto, e le pagine lo chiamano in ogni ramo di errore.
 */
export type ManopolaAntiBot = { reset: () => void };

function TurnstileConReset(
  { siteKey, onVerify, onExpire, onError, theme = 'auto' }: Props,
  manopola: React.Ref<ManopolaAntiBot>,
) {
  const ref = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  // #115 — Le funzioni di richiamo cambiano identita' a ogni disegno: se
  // restano fra le dipendenze, l'effetto si rifa' in continuazione e il
  // riquadro viene smontato e rimontato. Si tengono da parte e aggiornate.
  const richiami = useRef({ onVerify, onExpire, onError });
  richiami.current = { onVerify, onExpire, onError };

  useEffect(() => {
    if (!siteKey || !ref.current) return;
    let vivo = true;

    const fallito = (motivo: string) => {
      if (vivo) richiami.current.onError?.(motivo);
    };

    const render = () => {
      if (!window.turnstile || !ref.current) return;
      if (widgetId.current) return;
      try {
        widgetId.current = window.turnstile.render(ref.current, {
          sitekey: siteKey,
          theme,
          callback: (token: string) => richiami.current.onVerify(token),
          'expired-callback': () => richiami.current.onExpire?.(),
          'error-callback': () => fallito('Il controllo anti-bot non ha risposto.'),
        });
      } catch {
        fallito('Il controllo anti-bot non si e\' aperto.');
      }
    };

    if (window.__turnstileLoaded) {
      render();
    } else {
      const existing = document.getElementById('cf-turnstile-script');
      if (!existing) {
        const s = document.createElement('script');
        s.id = 'cf-turnstile-script';
        s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        s.async = true;
        s.defer = true;
        s.onload = () => {
          window.__turnstileLoaded = true;
          render();
        };
        // #115 — Se lo script non arriva, si dice. Prima non succedeva niente:
        // silenzio, e il modulo bloccato per sempre.
        s.onerror = () => fallito('Il controllo anti-bot non si e\' caricato.');
        document.head.appendChild(s);
      } else {
        existing.addEventListener('load', () => {
          window.__turnstileLoaded = true;
          render();
        });
        existing.addEventListener('error', () => fallito('Il controllo anti-bot non si e\' caricato.'));
      }
      // Rete di sicurezza: se dopo dieci secondi non e' successo niente — script
      // fermo, richiesta appesa — vale come «non disponibile».
      window.setTimeout(() => {
        if (!widgetId.current) fallito('Il controllo anti-bot non ha risposto in tempo.');
      }, 10_000);
    }

    return () => {
      vivo = false;
      if (widgetId.current && window.turnstile) {
        try { window.turnstile.remove(widgetId.current); } catch { /* noop */ }
        widgetId.current = null;
      }
    };
  }, [siteKey, theme]);

  useImperativeHandle(manopola, () => ({
    reset: () => {
      if (widgetId.current && window.turnstile) {
        try { window.turnstile.reset(widgetId.current); } catch { /* noop */ }
      }
    },
  }), []);

  return <div ref={ref} className="cf-turnstile" />;
}

const Turnstile = forwardRef<ManopolaAntiBot, Props>(TurnstileConReset);
Turnstile.displayName = 'Turnstile';
export default Turnstile;
