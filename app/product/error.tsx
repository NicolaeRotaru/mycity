'use client';

import { startTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ErrorState } from '@/components/ui/ErrorState';
import { captureError } from '@/lib/analytics/sentry';

/**
 * R07-014 — SENZA DATABASE LA SCHEDA PRODOTTO DICEVA «QUALCOSA È ANDATO STORTO».
 *
 * Quando la lettura del prodotto non arriva, il guscio (`[id]/layout.tsx`) lancia di proposito, per
 * non dire «non trovato» a Google. L'`error.tsx` della cartella `[id]` non copre il guscio della sua
 * stessa cartella: l'errore finiva nella pagina d'errore generica di tutto il sito, e la pagina non
 * arrivava mai al suo ramo isError. Questo confine sta sopra il guscio: dice la stessa cosa della
 * pagina, con «Riprova» e la strada verso il catalogo. «Riprova» rilegge dal server, poi ridisegna.
 */
export default function ProductSegmentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  useEffect(() => {
    captureError(error, { digest: error.digest, context: 'product-detail-error' });
  }, [error]);

  return (
    <div className="container mx-auto p-8 max-w-md text-center mt-8">
      <ErrorState
        title="Impossibile caricare il prodotto"
        description="C'è stato un problema di caricamento. Controlla la connessione e riprova."
        retry={() => startTransition(() => { router.refresh(); reset(); })}
        backHref="/categorie"
        backLabel="Vedi tutte le categorie"
        codiceErrore={error.digest}
      />
    </div>
  );
}
