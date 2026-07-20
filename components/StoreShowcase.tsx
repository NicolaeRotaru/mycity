'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import StorePreviewCard, { type ProductPreview, type StoreCardData } from './StorePreviewCard';
import ErrorState from './ErrorState';
import { queryKeys } from '@/lib/queries/keys';

type Store = StoreCardData;
type ProductLite = ProductPreview & { seller_id: string };

const fetchShowcase = async () => {
  const { data: storesRaw, error } = await supabase
    .from('seller_public_profiles')
    .select('id, store_name, store_address, store_logo, store_hours, store_media, is_approved, stripe_charges_enabled, stripe_payouts_enabled')
    .limit(6);
  if (error) throw error;

  const stores = (storesRaw ?? []) as Store[];
  const storeIds = stores.map((s) => s.id);
  if (storeIds.length === 0) return { stores: [], productsByStore: {}, reviewsByStore: {} };

  const [productsRes, reviewsRes] = await Promise.all([
    supabase
      .from('products')
      .select('id, name, price, images, seller_id')
      .in('seller_id', storeIds)
      .eq('status', 'available')
      .order('created_at', { ascending: false })
      .limit(200),
    supabase.rpc('store_review_stats', { p_store_ids: storeIds }),
  ]);

  const productsByStore: Record<string, ProductLite[]> = {};
  for (const p of (productsRes.data ?? []) as ProductLite[]) {
    (productsByStore[p.seller_id] ??= []).push(p);
  }

  const reviewsByStore: Record<string, { avg: number; count: number }> = {};
  for (const r of (reviewsRes.data ?? []) as { store_id: string; avg: number | string; count: number }[]) {
    reviewsByStore[r.store_id] = { avg: Number(r.avg), count: Number(r.count) };
  }

  return { stores, productsByStore, reviewsByStore };
};

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
