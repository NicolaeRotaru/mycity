'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import StorePreviewCard, { type ProductPreview, type StoreCardData } from '@/components/StorePreviewCard';
import { haversineKm } from '@/lib/geo';

type Store = StoreCardData & {
  store_phone: string | null;
  store_lat: number | null;
  store_lng: number | null;
};

type ProductLite = ProductPreview & { seller_id: string };

const fetchNearData = async () => {
  const { data: storesRaw } = await supabase
    .from('profiles')
    .select('id, store_name, store_phone, store_address, store_lat, store_lng, store_logo, store_hours, store_media')
    .eq('is_approved', true)
    .not('store_name', 'is', null);

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
      .limit(400),
    supabase
      .from('store_reviews')
      .select('store_id, rating')
      .in('store_id', storeIds),
  ]);

  const productsByStore: Record<string, ProductLite[]> = {};
  for (const p of (productsRes.data ?? []) as ProductLite[]) {
    (productsByStore[p.seller_id] ??= []).push(p);
  }

  const reviewsByStore: Record<string, { avg: number; count: number }> = {};
  for (const r of (reviewsRes.data ?? []) as { store_id: string; rating: number }[]) {
    const ex = reviewsByStore[r.store_id];
    if (ex) {
      ex.avg = (ex.avg * ex.count + r.rating) / (ex.count + 1);
      ex.count += 1;
    } else {
      reviewsByStore[r.store_id] = { avg: r.rating, count: 1 };
    }
  }

  return { stores, productsByStore, reviewsByStore };
};

export default function NearMePage() {
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [permError, setPermError] = useState<string | null>(null);

  useEffect(() => {
    if (!navigator.geolocation) {
      setPermError('Geolocalizzazione non supportata dal browser');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => setPos({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (err) => setPermError('Impossibile ottenere la posizione: ' + err.message),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ['near-stores-v2'],
    queryFn: fetchNearData,
  });

  const stores = data?.stores ?? [];
  const productsByStore = data?.productsByStore ?? {};
  const reviewsByStore = data?.reviewsByStore ?? {};

  if (permError) {
    return (
      <div className="container mx-auto p-8 text-center space-y-4 max-w-md">
        <p className="text-5xl">📍</p>
        <p className="text-gray-700 font-semibold">{permError}</p>
        <p className="text-gray-500 text-sm">Abilita la geolocalizzazione del browser per vedere i negozi più vicini.</p>
        <Link href="/stores" className="inline-block bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg">
          Vedi tutti i negozi
        </Link>
      </div>
    );
  }

  if (!pos || isLoading) {
    return <div className="container mx-auto p-8 text-center text-gray-500">📡 Calcolo distanze…</div>;
  }

  const ranked = stores
    .map((s) => ({
      store: s,
      distance: s.store_lat && s.store_lng
        ? haversineKm(pos.lat, pos.lng, Number(s.store_lat), Number(s.store_lng))
        : null,
    }))
    .filter((x) => x.distance !== null)
    .sort((a, b) => (a.distance as number) - (b.distance as number));

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-3xl sm:text-4xl font-extrabold text-gray-900">Vicino a te</h1>
        <p className="text-gray-500 mt-1">{ranked.length} negozi ordinati per distanza</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {ranked.map(({ store, distance }) => (
          <StorePreviewCard
            key={store.id}
            store={store}
            products={productsByStore[store.id] ?? []}
            reviews={reviewsByStore[store.id]}
            distanceKm={distance}
          />
        ))}
      </div>
    </div>
  );
}
