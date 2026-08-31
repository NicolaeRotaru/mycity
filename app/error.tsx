'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/ui/ErrorState';
import { captureError } from '@/lib/analytics/sentry';

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
        description="Abbiamo registrato il problema. Riprova fra un momento."
        retry={reset}
        backHref="/"
        backLabel="Torna alla home"
      />
      {/*
        31/8/2026 (R194) — Il `digest` è lo stesso identificativo che Next
        scrive nei log del server: è l'unico filo che lega una telefonata
        all'errore vero. Finiva solo dentro Sentry, quindi chi ci scriveva
        «non funziona» poteva darci al massimo un'ora approssimativa da cui
        far partire la caccia nei log.
        Se il digest non c'è (errori che Next non digerisce, sviluppo in
        locale) la riga non compare affatto: un'etichetta sola, o la parola
        «undefined» sotto le scuse, sembra un secondo errore.
      */}
      {error.digest ? (
        <p className="mt-6 text-center text-xs leading-relaxed text-ink-500">
          Codice errore:{' '}
          <code className="font-mono text-ink-700 select-all break-all">{error.digest}</code>
          {' — riportalo se ci scrivi.'}
        </p>
      ) : null}
    </div>
  );
}
