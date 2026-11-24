'use client';

import { startTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ErrorState } from '@/components/ui/ErrorState';
import { captureError } from '@/lib/analytics/sentry';

/**
 * R07-014 — SENZA DATABASE LA CATEGORIA DICEVA «QUALCOSA È ANDATO STORTO».
 *
 * Quando la lettura della categoria non arriva, i metadati del guscio (`[slug]/layout.tsx`) lanciano
 * di proposito, per non dire «non trovato» a Google. L'errore partiva prima che la pagina arrivasse
 * al suo ramo isError e finiva nella pagina d'errore generica di tutto il sito. Questo confine sta
 * sopra il guscio: dice la stessa cosa della pagina, con «Riprova» e la strada verso le categorie.
 * «Riprova» rilegge dal server (l'errore è nato lì), poi ridisegna.
 */
export default function CategoryError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  useEffect(() => {
    captureError(error, { digest: error.digest, context: 'category-error' });
  }, [error]);

  return (
    <div className="container mx-auto px-4 sm:px-6 py-8">
      <ErrorState
        title="Non riesco a caricare questa categoria"
        description="C'è stato un problema di collegamento. La categoria probabilmente c'è: riprova fra un attimo."
        retry={() => startTransition(() => { router.refresh(); reset(); })}
        backHref="/categorie"
        backLabel="Vedi tutte le categorie"
        codiceErrore={error.digest}
      />
    </div>
  );
}
