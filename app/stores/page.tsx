'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import StorePreviewCard, { type ProductPreview, type StoreCardData } from '@/components/StorePreviewCard';
import { DAY_KEYS, isOpenNow, type StoreHours } from '@/lib/store-hours';
import { LoadingState } from '@/components/ui/LoadingState';
import { queryKeys } from '@/lib/queries/keys';

type Store = StoreCardData & {
  store_phone: string | null;
  store_lat: number | null;
  store_lng: number | null;
};

type ProductLite = ProductPreview & { seller_id: string; category_id: string | null };

type Category = { id: string; slug: string; name: string; parent_id: string | null; icon: string | null };

type SortMode = 'rating' | 'name' | 'most-products';

const fetchStoresData = async () => {
  const { data: storesRaw } = await supabase
    .from('profiles')
    .select('id, store_name, store_phone, store_address, store_lat, store_lng, store_logo, store_hours, store_media')
    .eq('is_approved', true)
    .not('store_name', 'is', null)
    .order('store_name');

  const stores = (storesRaw ?? []) as Store[];
  const storeIds = stores.map((s) => s.id);
  if (storeIds.length === 0) {
    return { stores: [], productsByStore: {}, reviewsByStore: {}, countByStore: {}, categoriesByStore: {}, categories: [] };
  }

  // 3 query parallele (era 4 — la query di conteggio era ridondante con
  // products). Da products deriviamo display + count + categorie per store.
  const [productsRes, reviewsRes, categoriesRes] = await Promise.all([
    supabase
      .from('products')
      .select('id, name, price, images, seller_id, category_id')
      .in('seller_id', storeIds)
      .eq('status', 'available')
      .order('created_at', { ascending: false })
      .limit(600),
    supabase.rpc('store_review_stats', { p_store_ids: storeIds }),
    supabase
      .from('categories')
      .select('id, slug, name, parent_id, icon')
      .is('parent_id', null)
      .order('name'),
  ]);

  const products = (productsRes.data ?? []) as ProductLite[];
  const reviewRows = (reviewsRes.data ?? []) as { store_id: string; avg: number | string; count: number }[];
  const categories = (categoriesRes.data ?? []) as Category[];

  const productsByStore: Record<string, ProductLite[]> = {};
  const countByStore: Record<string, number> = {};
  const categoriesByStore: Record<string, Set<string>> = {};
  for (const p of products) {
    (productsByStore[p.seller_id] ??= []).push(p);
    countByStore[p.seller_id] = (countByStore[p.seller_id] ?? 0) + 1;
    if (p.category_id) {
      (categoriesByStore[p.seller_id] ??= new Set()).add(p.category_id);
    }
  }

  const reviewsByStore: Record<string, { avg: number; count: number }> = {};
  for (const r of reviewRows) {
    reviewsByStore[r.store_id] = { avg: Number(r.avg), count: Number(r.count) };
  }

  return { stores, productsByStore, reviewsByStore, countByStore, categoriesByStore, categories };
};

export default function StoresPage() {
  const [search, setSearch] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [sort, setSort] = useState<SortMode>('rating');
  const [categoryId, setCategoryId] = useState<string>('');

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.stores.page,
    queryFn: fetchStoresData,
    staleTime: 30_000,
    gcTime: 10 * 60_000,
  });

  // useMemo per stabilizzare reference: fallback `?? []` / `?? {}` produce
  // un nuovo oggetto ad ogni render senza memo, che fa schizzare le deps
  // dei useMemo dipendenti (lint warning react-hooks/exhaustive-deps).
  const stores = useMemo(() => data?.stores ?? [], [data?.stores]);
  const productsByStore = useMemo(() => data?.productsByStore ?? {}, [data?.productsByStore]);
  const reviewsByStore = useMemo(() => data?.reviewsByStore ?? {}, [data?.reviewsByStore]);
  const countByStore = useMemo(() => data?.countByStore ?? {}, [data?.countByStore]);
  const categoriesByStore = useMemo(() => data?.categoriesByStore ?? {}, [data?.categoriesByStore]);
  const categories = data?.categories ?? [];

  const filtered = useMemo(() => {
    const todayKey = DAY_KEYS[new Date().getDay()];
    let result = stores.filter((s) => {
      if (search && !s.store_name?.toLowerCase().includes(search.toLowerCase())) return false;
      if (onlyOpen) {
        const hours = (s.store_hours ?? {}) as StoreHours;
        if (!isOpenNow(hours[todayKey])) return false;
      }
      if (categoryId) {
        const cats = categoriesByStore[s.id];
        if (!cats || !cats.has(categoryId)) return false;
      }
      return true;
    });

    if (sort === 'name') {
      result = [...result].sort((a, b) => (a.store_name ?? '').localeCompare(b.store_name ?? ''));
    } else if (sort === 'rating') {
      result = [...result].sort((a, b) => {
        const ra = reviewsByStore[a.id]?.avg ?? 0;
        const rb = reviewsByStore[b.id]?.avg ?? 0;
        if (rb !== ra) return rb - ra;
        return (countByStore[b.id] ?? 0) - (countByStore[a.id] ?? 0);
      });
    } else if (sort === 'most-products') {
      result = [...result].sort((a, b) => (countByStore[b.id] ?? 0) - (countByStore[a.id] ?? 0));
    }
    return result;
  }, [stores, search, onlyOpen, sort, categoryId, reviewsByStore, countByStore, categoriesByStore]);

  if (isLoading) {
    return <LoadingState />;
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-3xl sm:text-4xl font-extrabold text-ink-900">
          Negozi di Piacenza
        </h1>
        <p className="text-ink-500 mt-1">
          {stores.length} negozi locali pronti a consegnarti a casa
        </p>
      </div>

      {/* Filtri */}
      <div className="bg-white border border-cream-300 rounded-xl p-3 mb-6 shadow-sm space-y-2">
        <div className="flex gap-2 flex-wrap items-center">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="🔍 Cerca per nome negozio…"
            className="flex-1 min-w-[160px] border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
          />
          <button
            onClick={() => setOnlyOpen((v) => !v)}
            className={`px-3 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all ${
              onlyOpen ? 'bg-olive-500 text-white' : 'bg-cream-100 text-ink-700 hover:bg-cream-200'
            }`}
          >
            🟢 Aperti ora
          </button>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortMode)}
            className="border rounded-lg px-3 py-2 text-sm bg-white font-semibold"
          >
            <option value="rating">⭐ Più amati</option>
            <option value="most-products">📦 Più assortiti</option>
            <option value="name">A-Z</option>
          </select>
        </div>
        {categories.length > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            <button
              onClick={() => setCategoryId('')}
              className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${
                categoryId === '' ? 'bg-primary-700 text-white' : 'bg-cream-100 text-ink-700 hover:bg-cream-200'
              }`}
            >
              Tutti i settori
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => setCategoryId(c.id === categoryId ? '' : c.id)}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${
                  c.id === categoryId ? 'bg-primary-700 text-white' : 'bg-cream-100 text-ink-700 hover:bg-cream-200'
                }`}
              >
                {c.icon} {c.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-ink-500 bg-white border rounded-xl">
          <p className="text-5xl mb-3">🔍</p>
          <p className="font-semibold">Nessun negozio trovato con questi filtri.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((s) => (
            <StorePreviewCard
              key={s.id}
              store={s}
              products={productsByStore[s.id] ?? []}
              reviews={reviewsByStore[s.id]}
            />
          ))}
        </div>
      )}
    </div>
  );
}
