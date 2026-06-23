'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/ui/ErrorState';
import { captureError } from '@/lib/analytics/sentry';

/**
 * Error boundary dell'area admin (audit 🟠-19). Prima un errore di render/fetch
 * nelle pagine /admin cadeva sull'error globale generico; qui mostriamo un
 * fallback contestuale con retry e logghiamo su Sentry.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureError(error, { digest: error.digest, area: 'admin' });
  }, [error]);

  return (
    <div className="container mx-auto px-4 py-12 max-w-2xl">
      <ErrorState
        title="Errore nel pannello admin"
        description="Abbiamo registrato il problema. Riprova fra un momento."
        retry={reset}
        backHref="/admin"
        backLabel="Pannello admin"
      />
    </div>
  );
}
