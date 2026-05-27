'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/ui/ErrorState';
import { captureError } from '@/lib/analytics/sentry';

export default function ProductError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureError(error, { digest: error.digest, context: 'product-detail-error' });
  }, [error]);

  return (
    <div className="container mx-auto px-4 sm:px-6 py-12">
      <ErrorState
        title="Errore nel caricamento del prodotto"
        description="Il prodotto potrebbe essere stato rimosso o c'è un problema temporaneo. Riprova o torna alla home."
        retry={reset}
        backHref="/"
        backLabel="Torna alla home"
      />
    </div>
  );
}
