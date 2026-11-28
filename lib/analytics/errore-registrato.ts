'use client';

import { useEffect, useState } from 'react';
import { captureError } from '@/lib/analytics/sentry';

/**
 * 28/11/2026 (R08-002, onda 2) — «ABBIAMO REGISTRATO IL PROBLEMA» SOLO SE È VERO.
 *
 * Le pagine d'errore lo dicevano col solo DSN configurato (R03-004). Ma un errore nel telefono del
 * cliente può non arrivare a nessuno anche col DSN: il registratore non ancora acceso nei primi istanti,
 * il suo pezzo di codice che non si scarica sulla stessa rete che ha rotto la pagina. Qui l'errore si
 * manda al registratore una volta, e la risposta è vera solo quando `captureError` ha detto di averlo
 * consegnato. Finché non lo sa, la pagina dice soltanto «riprova».
 */
export function useErroreRegistrato(error: Error & { digest?: string }, area?: string): boolean {
  const [registrato, setRegistrato] = useState(false);
  useEffect(() => {
    let vivo = true;
    void Promise.resolve(captureError(error, { digest: error.digest, ...(area ? { area } : {}) })).then(
      (consegnato) => {
        if (vivo) setRegistrato(consegnato === true);
      },
      () => {
        if (vivo) setRegistrato(false);
      },
    );
    return () => {
      vivo = false;
    };
  }, [error, area]);
  return registrato;
}
