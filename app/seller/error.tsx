'use client';

import { ErrorState } from '@/components/ui/ErrorState';
import { useErroreRegistrato } from '@/lib/analytics/errore-registrato';

/**
 * Error boundary dell'area seller (audit 🟠-19): fallback contestuale con retry
 * invece dell'error globale, + capture su Sentry.
 */
export default function SellerError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // R08-002 (onda 2) — La frase «abbiamo registrato» solo se il registratore ha preso davvero l'errore.
  const registrato = useErroreRegistrato(error, 'seller');

  return (
    <div className="container mx-auto px-4 py-12 max-w-2xl">
      <ErrorState
        title="Errore nell'area venditore"
        description={registrato ? 'Abbiamo registrato il problema. Riprova fra un momento.' : 'Riprova fra un momento.'}
        retry={reset}
        backHref="/seller/dashboard"
        backLabel="Dashboard"
        codiceErrore={error.digest}
      />
    </div>
  );
}
