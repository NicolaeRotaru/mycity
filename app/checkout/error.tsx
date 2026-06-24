'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/ui/ErrorState';
import { captureError } from '@/lib/analytics/sentry';

export default function CheckoutError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Checkout errors sono critici: track con priorita' alta in Sentry
    captureError(error, { digest: error.digest, context: 'checkout-error', priority: 'high' });
  }, [error]);

  return (
    <div className="container mx-auto px-4 sm:px-6 py-12 max-w-2xl">
      <ErrorState
        title="Problema durante il checkout"
        description="Il tuo carrello è salvato. Riprova o contatta il supporto se il problema persiste."
        retry={reset}
        backHref="/cart"
        backLabel="Torna al carrello"
      />
    </div>
  );
}
