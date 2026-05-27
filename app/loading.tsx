import { LoadingState } from '@/components/ui/LoadingState';

/**
 * Root loading boundary — mostrato durante navigation/RSC streaming.
 * Skeleton-based per evitare CLS (Cumulative Layout Shift).
 */
export default function RootLoading() {
  return (
    <div className="container mx-auto px-4 sm:px-6 py-12">
      <LoadingState variant="skeleton" rows={6} />
    </div>
  );
}
