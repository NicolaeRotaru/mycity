'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import StorePreviewCard, { type ProductPreview, type StoreCardData } from './StorePreviewCard';
import { queryKeys } from '@/lib/queries/keys';

type Store = StoreCardData;
type ProductLite = ProductPreview & { seller_id: string };

const fetchShowcase = async () => {
  const { data: storesRaw } = await supabase
    .from('profiles')
    .select('id, store_name, store_address, store_logo, store_hours, store_media')
    .eq('is_approved', true)
    .not('store_name', 'is', null)
    .limit(6);

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
  const { data } = useQuery({
    queryKey: queryKeys.stores.showcase,
    queryFn: fetchShowcase,
    staleTime: 60_000,
  });

  const stores = data?.stores ?? [];
  const productsByStore = data?.productsByStore ?? {};
  const reviewsByStore = data?.reviewsByStore ?? {};

  if (stores.length === 0) {
    return <p className="text-ink-500 text-sm">Nessun negozio approvato ancora.</p>;
  }

  return (
    <div className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto scrollbar-hide px-4 pb-2 sm:-mx-6 sm:px-6">
      {stores.map((s) => (
        <div key={s.id} className="w-64 shrink-0 snap-start">
          <StorePreviewCard
            store={s}
            products={productsByStore[s.id] ?? []}
            reviews={reviewsByStore[s.id]}
          />
        </div>
      ))}
    </div>
  );
};

export default StoreShowcase;
