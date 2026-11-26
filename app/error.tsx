'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/ui/ErrorState';
import { captureError } from '@/lib/analytics/sentry';
import { SENTRY_DSN } from '@/lib/analytics/sentry-config';

// Senza NEXT_PUBLIC_SENTRY_DSN captureError scrive solo nella console del browser: la frase «Abbiamo
// registrato il problema» sarebbe falsa (stessa regola delle pagine d'errore del venditore e del fattorino).
const registratoreAcceso = () => Boolean(SENTRY_DSN);

/**
 * Error boundary per route — Next.js App Router convention.
 *
 * Cattura errori in render/effect dei page component. Logga su Sentry
 * e mostra ErrorState con retry.
 *
 * Esperti consultati:
 * - SRE: "Senza error.tsx, utente vede Next default error UI (brand rotto).
 *   Con error.tsx, brand consistency + Sentry capture automatic."
 */

export default function PageError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureError(error, { digest: error.digest });
  }, [error]);

  return (
    <div className="container mx-auto px-4 py-12 max-w-2xl">
      <ErrorState
        title="Qualcosa è andato storto"
        description={registratoreAcceso() ? 'Abbiamo registrato il problema. Riprova fra un momento.' : 'Riprova fra un momento.'}
        retry={reset}
        backHref="/"
        backLabel="Torna alla home"
        codiceErrore={error.digest}
      />
    </div>
  );
}
