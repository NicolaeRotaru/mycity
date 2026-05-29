'use client';

import { useEffect } from 'react';

/**
 * Registra il service worker (/sw.js) al caricamento dell'app, per abilitare
 * PWA install + offline/caching a TUTTI gli utenti (prima il SW veniva
 * registrato solo all'opt-in delle notifiche push). Idempotente: registrare lo
 * stesso SW più volte è un no-op. Attende l'evento load per non competere con
 * le risorse critiche del first paint.
 */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => { /* non bloccante */ });
    };
    if (document.readyState === 'complete') {
      register();
      return;
    }
    window.addEventListener('load', register, { once: true });
    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
