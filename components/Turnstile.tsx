'use client';

import { useEffect, useRef } from 'react';

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
  theme?: 'light' | 'dark' | 'auto';
};

/**
 * Widget Cloudflare Turnstile. Carica lo script una sola volta in pagina
 * e renderizza un challenge invisibile/managed. Se la sitekey non è
 * configurata (lato server) il componente non viene montato dal parent.
 */
export default function Turnstile({ siteKey, onVerify, onExpire, theme = 'auto' }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    if (!siteKey || !ref.current) return;

    const render = () => {
      if (!window.turnstile || !ref.current) return;
      if (widgetId.current) return;
      widgetId.current = window.turnstile.render(ref.current, {
        sitekey: siteKey,
        theme,
        callback: (token: string) => onVerify(token),
        'expired-callback': () => onExpire?.(),
      });
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
        document.head.appendChild(s);
      } else {
        existing.addEventListener('load', () => {
          window.__turnstileLoaded = true;
          render();
        });
      }
    }

    return () => {
      if (widgetId.current && window.turnstile) {
        try { window.turnstile.remove(widgetId.current); } catch { /* noop */ }
        widgetId.current = null;
      }
    };
  }, [siteKey, theme, onVerify, onExpire]);

  return <div ref={ref} className="cf-turnstile" />;
}
