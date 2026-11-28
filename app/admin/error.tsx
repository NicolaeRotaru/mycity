'use client';

import { ErrorState } from '@/components/ui/ErrorState';
import { useErroreRegistrato } from '@/lib/analytics/errore-registrato';

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
  // R08-002 (onda 2) — La frase «abbiamo registrato» solo se il registratore ha preso davvero l'errore.
  const registrato = useErroreRegistrato(error, 'admin');

  return (
    <div className="container mx-auto px-4 py-12 max-w-2xl">
      <ErrorState
        title="Errore nel pannello admin"
        description={registrato ? 'Abbiamo registrato il problema. Riprova fra un momento.' : 'Riprova fra un momento.'}
        retry={reset}
        backHref="/admin"
        backLabel="Pannello admin"
        codiceErrore={error.digest}
      />
    </div>
  );
}
