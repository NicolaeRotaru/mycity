'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import StorePreviewCard, { type ProductPreview, type StoreCardData } from './StorePreviewCard';
import { ErrorState } from './ui/ErrorState';
import { queryKeys } from '@/lib/queries/keys';
import { leggiVetrinaNegozi } from '@/lib/queries/vetrina-negozi';

type Store = StoreCardData;

/**
 * 27/8/2026 (R079) — la lettura sta in `lib/queries/vetrina-negozi.ts`, dove una prova la esegue:
 * qui dentro nessuno poteva accorgersi né dei duecento prodotti scaricati per mostrarne diciotto,
 * né dei sei negozi scelti senza un ordine.
 */
const fetchShowcase = () => leggiVetrinaNegozi<Store>(supabase);

const StoreShowcase = () => {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.stores.showcase,
    queryFn: fetchShowcase,
    staleTime: 60_000,
  });

  // Skeleton durante il caricamento: evita il CLS (prima non c'era nessuno stato di load).
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="overflow-hidden rounded-2xl border border-cream-200 bg-white">
            <div className="aspect-[4/3] animate-pulse bg-cream-200" />
            <div className="space-y-2 p-3">
              <div className="h-4 w-2/3 animate-pulse rounded bg-cream-200" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-cream-100" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Errore di rete/DB distinto dal vuoto reale ("Nessun negozio approvato ancora").
  if (isError) {
    return (
      <ErrorState
        variant="compact"
        title="Impossibile caricare i negozi"
        onRetry={() => refetch()}
      />
    );
  }

  const stores = data?.stores ?? [];
  const productsByStore = data?.productsByStore ?? {};
  const reviewsByStore = data?.reviewsByStore ?? {};

  if (stores.length === 0) {
    return <p className="text-ink-500 text-sm">Nessun negozio approvato ancora.</p>;
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {stores.map((s) => (
        <StorePreviewCard
          key={s.id}
          store={s}
          products={productsByStore[s.id] ?? []}
          reviews={reviewsByStore[s.id]}
        />
      ))}
    </div>
  );
};

export default StoreShowcase;
