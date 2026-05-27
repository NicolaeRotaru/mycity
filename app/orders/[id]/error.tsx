'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/ui/ErrorState';
import { captureError } from '@/lib/analytics/sentry';

export default function OrderError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureError(error, { digest: error.digest, context: 'order-detail-error' });
  }, [error]);

  return (
    <div className="container mx-auto px-4 sm:px-6 py-12">
      <ErrorState
        title="Errore nel caricamento dell'ordine"
        description="Non siamo riusciti a recuperare i dettagli dell'ordine. Riprova o vedi tutti i tuoi ordini."
        retry={reset}
        backHref="/orders"
        backLabel="I miei ordini"
      />
    </div>
  );
}
