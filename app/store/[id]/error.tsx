'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/ui/ErrorState';
import { captureError } from '@/lib/analytics/sentry';

export default function StoreError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureError(error, { digest: error.digest, context: 'store-page-error' });
  }, [error]);

  return (
    <div className="container mx-auto px-4 sm:px-6 py-12">
      <ErrorState
        title="Errore nel caricamento del negozio"
        description="Il negozio potrebbe essere stato sospeso o c'è un problema temporaneo."
        retry={reset}
        backHref="/stores"
        backLabel="Vedi tutti i negozi"
      />
    </div>
  );
}
