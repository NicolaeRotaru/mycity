'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import StorePreviewCard, { type ProductPreview, type StoreCardData } from '@/components/StorePreviewCard';
import { DAY_KEYS, isOpenNow, type StoreHours } from '@/lib/store-hours';

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

  const [productsRes, reviewsRes, allProductsCatRes, categoriesRes] = await Promise.all([
    supabase
      .from('products')
      .select('id, name, price, images, seller_id, category_id')
      .in('seller_id', storeIds)
      .eq('status', 'available')
      .order('created_at', { ascending: false })
      .limit(400),
    supabase
      .from('store_reviews')
      .select('store_id, rating')
      .in('store_id', storeIds),
    supabase
      .from('products')
      .select('seller_id, category_id')
      .in('seller_id', storeIds)
      .eq('status', 'available'),
    supabase
      .from('categories')
      .select('id, slug, name, parent_id, icon')
      .is('parent_id', null)
      .order('name'),
  ]);

  const products = (productsRes.data ?? []) as ProductLite[];
  const reviews = (reviewsRes.data ?? []) as { store_id: string; rating: number }[];
  const allCats = (allProductsCatRes.data ?? []) as { seller_id: string; category_id: string | null }[];
  const categories = (categoriesRes.data ?? []) as Category[];

  const productsByStore: Record<string, ProductLite[]> = {};
  for (const p of products) {
    (productsByStore[p.seller_id] ??= []).push(p);
  }

  const reviewsByStore: Record<string, { avg: number; count: number }> = {};
  for (const r of reviews) {
    const ex = reviewsByStore[r.store_id];
    if (ex) {
      ex.avg = (ex.avg * ex.count + r.rating) / (ex.count + 1);
      ex.count += 1;
    } else {
      reviewsByStore[r.store_id] = { avg: r.rating, count: 1 };
    }
  }

  const countByStore: Record<string, number> = {};
  const categoriesByStore: Record<string, Set<string>> = {};
  for (const c of allCats) {
    countByStore[c.seller_id] = (countByStore[c.seller_id] ?? 0) + 1;
    if (c.category_id) {
      (categoriesByStore[c.seller_id] ??= new Set()).add(c.category_id);
    }
  }

  return { stores, productsByStore, reviewsByStore, countByStore, categoriesByStore, categories };
};

export default function StoresPage() {
  const [search, setSearch] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [sort, setSort] = useState<SortMode>('rating');
  const [categoryId, setCategoryId] = useState<string>('');

  const { data, isLoading } = useQuery({
    queryKey: ['stores-page-v4'],
    queryFn: fetchStoresData,
    staleTime: 60_000,
  });

  const stores = data?.stores ?? [];
  const productsByStore = data?.productsByStore ?? {};
  const reviewsByStore = data?.reviewsByStore ?? {};
  const countByStore = data?.countByStore ?? {};
  const categoriesByStore = data?.categoriesByStore ?? {};
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
    return <div className="container mx-auto p-12 text-center text-gray-500">Caricamento negozi...</div>;
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-3xl sm:text-4xl font-extrabold text-gray-900">
          Negozi di Piacenza
        </h1>
        <p className="text-gray-500 mt-1">
          {stores.length} negozi locali pronti a consegnarti a casa
        </p>
      </div>

      {/* Filtri */}
      <div className="bg-white border border-gray-200 rounded-xl p-3 mb-6 shadow-sm space-y-2">
        <div className="flex gap-2 flex-wrap items-center">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="🔍 Cerca per nome negozio…"
            className="flex-1 min-w-[160px] border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
          <button
            onClick={() => setOnlyOpen((v) => !v)}
            className={`px-3 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all ${
              onlyOpen ? 'bg-emerald-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
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
                categoryId === '' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Tutti i settori
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => setCategoryId(c.id === categoryId ? '' : c.id)}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${
                  c.id === categoryId ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {c.icon} {c.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-500 bg-white border rounded-xl">
          <p className="text-5xl mb-3">🔍</p>
          <p className="font-semibold">Nessun negozio trovato con questi filtri.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
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
