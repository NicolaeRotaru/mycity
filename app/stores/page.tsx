'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import StoreAvatar from '@/components/StoreAvatar';
import { formatPrice } from '@/lib/format';
import {
  DAY_KEYS,
  formatToday,
  isOpenNow,
  streetFromAddress,
  type StoreHours,
} from '@/lib/store-hours';

type Store = {
  id: string;
  store_name: string;
  store_phone: string | null;
  store_address: string | null;
  store_lat: number | null;
  store_lng: number | null;
  store_logo: string | null;
  store_hours: any;
};

type ProductLite = {
  id: string;
  name: string;
  price: number;
  images: string[] | null;
  seller_id: string;
};

type SortMode = 'rating' | 'name' | 'most-products';

const fetchStoresData = async () => {
  const { data: storesRaw } = await supabase
    .from('profiles')
    .select('id, store_name, store_phone, store_address, store_lat, store_lng, store_logo, store_hours')
    .eq('is_approved', true)
    .not('store_name', 'is', null)
    .order('store_name');

  const stores = (storesRaw ?? []) as Store[];
  const storeIds = stores.map((s) => s.id);
  if (storeIds.length === 0) {
    return { stores: [], productsByStore: {}, reviewsByStore: {}, countByStore: {} };
  }

  const [productsRes, reviewsRes, countsRes] = await Promise.all([
    supabase
      .from('products')
      .select('id, name, price, images, seller_id')
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
      .select('id, seller_id')
      .in('seller_id', storeIds)
      .eq('status', 'available'),
  ]);

  const products = (productsRes.data ?? []) as ProductLite[];
  const reviews = (reviewsRes.data ?? []) as { store_id: string; rating: number }[];
  const counts = (countsRes.data ?? []) as { seller_id: string; id: string }[];

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
  for (const c of counts) {
    countByStore[c.seller_id] = (countByStore[c.seller_id] ?? 0) + 1;
  }

  return { stores, productsByStore, reviewsByStore, countByStore };
};

export default function StoresPage() {
  const [search, setSearch] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [sort, setSort] = useState<SortMode>('rating');

  const { data, isLoading } = useQuery({
    queryKey: ['stores-page-v3'],
    queryFn: fetchStoresData,
    staleTime: 60_000,
  });

  const stores = data?.stores ?? [];
  const productsByStore = data?.productsByStore ?? {};
  const reviewsByStore = data?.reviewsByStore ?? {};
  const countByStore = data?.countByStore ?? {};

  const filtered = useMemo(() => {
    const todayKey = DAY_KEYS[new Date().getDay()];
    let result = stores.filter((s) => {
      if (search && !s.store_name?.toLowerCase().includes(search.toLowerCase())) return false;
      if (onlyOpen) {
        const hours = (s.store_hours ?? {}) as StoreHours;
        if (!isOpenNow(hours[todayKey])) return false;
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
        // tiebreaker: numero prodotti
        return (countByStore[b.id] ?? 0) - (countByStore[a.id] ?? 0);
      });
    } else if (sort === 'most-products') {
      result = [...result].sort((a, b) => (countByStore[b.id] ?? 0) - (countByStore[a.id] ?? 0));
    }
    return result;
  }, [stores, search, onlyOpen, sort, reviewsByStore, countByStore]);

  if (isLoading) {
    return <div className="container mx-auto p-12 text-center text-gray-500">Caricamento negozi...</div>;
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* Hero */}
      <div className="mb-6">
        <h1 className="text-3xl sm:text-4xl font-extrabold text-gray-900">
          Negozi di Piacenza
        </h1>
        <p className="text-gray-500 mt-1">
          {stores.length} negozi locali pronti a consegnarti a casa
        </p>
      </div>

      {/* Filtri sticky */}
      <div className="sticky top-32 z-10 bg-white/95 backdrop-blur border border-gray-200 rounded-xl p-3 mb-6 shadow-sm">
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
              onlyOpen
                ? 'bg-emerald-500 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
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
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-500 bg-white border rounded-xl">
          <p className="text-5xl mb-3">🔍</p>
          <p className="font-semibold">Nessun negozio trovato con questi filtri.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {filtered.map((s) => {
            const street = streetFromAddress(s.store_address);
            const hours = (s.store_hours ?? {}) as StoreHours;
            const todayKey = DAY_KEYS[new Date().getDay()];
            const todayIntervals = hours[todayKey];
            const open = isOpenNow(todayIntervals);
            const todayLabel = formatToday(todayIntervals);
            const reviews = reviewsByStore[s.id];
            const products = productsByStore[s.id] ?? [];
            const totalProducts = countByStore[s.id] ?? 0;

            // Trova prodotto featured = quello più "caro" tra i primi 8 (di solito è il più rappresentativo)
            const featured = products.slice(0, 8).reduce<ProductLite | null>(
              (best, p) => (!best || Number(p.price) > Number(best.price) ? p : best),
              null,
            );

            return (
              <Link
                key={s.id}
                href={`/store/${s.id}`}
                className="group bg-white border border-gray-200 rounded-2xl overflow-hidden hover:shadow-xl hover:border-indigo-300 hover:-translate-y-0.5 transition-all flex flex-col"
              >
                {/* Banner colorato con badge aperto/chiuso */}
                <div className="relative h-20 bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 shrink-0">
                  <span
                    className={`absolute top-3 right-3 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold shadow ${
                      open ? 'bg-emerald-500 text-white' : 'bg-black/60 text-white'
                    }`}
                  >
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                    {open ? 'Aperto ora' : 'Chiuso'}
                  </span>
                  {reviews && reviews.avg >= 4.5 && (
                    <span className="absolute top-3 left-3 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-400 text-gray-900 shadow">
                      🏆 Top-rated
                    </span>
                  )}
                </div>

                <div className="px-5 pb-5 flex-1 flex flex-col">
                  {/* Logo che sborda + info principali */}
                  <div className="flex items-start gap-3 -mt-10 mb-3">
                    <div className="ring-4 ring-white rounded-full bg-white shrink-0">
                      <StoreAvatar logoUrl={s.store_logo} storeName={s.store_name} size="lg" />
                    </div>
                    <div className="flex-1 min-w-0 pt-11">
                      <h3 className="font-extrabold text-lg text-gray-900 group-hover:text-indigo-600 transition-colors truncate">
                        {s.store_name}
                      </h3>
                      <div className="flex items-center gap-2 text-sm">
                        {reviews ? (
                          <span className="flex items-center gap-1">
                            <span className="text-amber-400">★</span>
                            <span className="font-bold text-gray-900">{reviews.avg.toFixed(1)}</span>
                            <span className="text-xs text-gray-400">({reviews.count})</span>
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">Nessuna recensione</span>
                        )}
                        <span className="text-gray-300">·</span>
                        <span className="text-xs text-gray-500">
                          <strong>{totalProducts}</strong> prodotti
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Indirizzo + orario */}
                  <div className="text-xs text-gray-500 mb-3 flex flex-wrap gap-x-3 gap-y-1">
                    {street && <span>📍 {street}</span>}
                    <span className={open ? 'text-emerald-600 font-semibold' : 'text-gray-500'}>
                      🕒 {todayLabel}
                    </span>
                  </div>

                  {/* Galleria prodotti */}
                  {products.length > 0 ? (
                    <div className="grid grid-cols-4 gap-1.5 mb-3">
                      {products.slice(0, 4).map((p) => (
                        <div
                          key={p.id}
                          className="aspect-square rounded-lg overflow-hidden bg-gray-100 relative"
                        >
                          {p.images?.[0] ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={p.images[0]}
                              alt={p.name}
                              className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-300 text-xl">📦</div>
                          )}
                          <span className="absolute bottom-0 left-0 right-0 bg-black/70 text-white text-[10px] font-bold py-0.5 text-center backdrop-blur">
                            {formatPrice(p.price)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="bg-gray-50 rounded-lg py-4 text-center text-xs text-gray-400 mb-3">
                      Nessun prodotto disponibile
                    </div>
                  )}

                  {/* CTA */}
                  <div className="mt-auto pt-3 border-t border-gray-100 flex items-center justify-between">
                    {featured ? (
                      <span className="text-xs text-gray-500 truncate min-w-0 mr-2">
                        Da <strong className="text-gray-900">{formatPrice(
                          Math.min(...products.slice(0, 8).map((p) => Number(p.price))),
                        )}</strong>
                      </span>
                    ) : (
                      <span />
                    )}
                    <span className="text-sm font-bold text-indigo-600 group-hover:translate-x-1 transition-transform whitespace-nowrap">
                      Esplora il negozio →
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
