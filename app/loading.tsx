import { LoadingState } from '@/components/ui/LoadingState';

/**
 * Root loading boundary — mostrato durante navigation/RSC streaming.
 * Variante "cards" branded (spinner + serif + griglia skeleton) per evitare
 * CLS (Cumulative Layout Shift) e dare continuità visiva alle griglie prodotto.
 */
export default function RootLoading() {
  return (
    <div className="container mx-auto px-4 sm:px-6 py-12">
      <LoadingState
        variant="cards"
        message="Stiamo caricando…"
        description="Prepariamo i prodotti dei negozi vicino a te."
      />
    </div>
  );
}
