'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/ui/ErrorState';
import { captureError } from '@/lib/analytics/sentry';

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
        description="Abbiamo registrato il problema. Riprova fra un momento."
        retry={reset}
        backHref="/rider"
        backLabel="Le tue consegne"
      />
    </div>
  );
}
