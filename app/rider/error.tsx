'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/ui/ErrorState';
import { captureError } from '@/lib/analytics/sentry';
import { SENTRY_DSN } from '@/lib/analytics/sentry-config';

/**
 * R03-004 — «Abbiamo registrato il problema» si dice solo se il registratore è acceso: senza
 * `NEXT_PUBLIC_SENTRY_DSN` `captureError` scrive solo nella console del browser, e la frase
 * sarebbe falsa (stessa regola dell'avviso della cassa). Qui, e non in `sentry.tsx`, perché quel
 * file non è nel mio elenco; se arriva un `registratoreAcceso()` condiviso si sostituisce questa riga.
 */
const registratoreAcceso = () => Boolean(SENTRY_DSN);

/**
 * Error boundary dell'area rider (audit 🟠-19): fallback contestuale con retry
 * invece dell'error globale, + capture su Sentry.
 */
export default function RiderError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureError(error, { digest: error.digest, area: 'rider' });
  }, [error]);

  return (
    <div className="container mx-auto px-4 py-12 max-w-2xl">
      <ErrorState
        title="Errore nell'area rider"
        description={registratoreAcceso() ? 'Abbiamo registrato il problema. Riprova fra un momento.' : 'Riprova fra un momento.'}
        retry={reset}
        backHref="/rider"
        backLabel="Le tue consegne"
        codiceErrore={error.digest}
      />
    </div>
  );
}
