'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import StoreAvatar from '@/components/StoreAvatar';
import { haversineKm } from '@/lib/geo';
import {
  DAY_KEYS,
  isOpenNow,
  streetFromAddress,
  type StoreHours,
} from '@/lib/store-hours';

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

  const { data: stores = [], isLoading } = useQuery({
    queryKey: ['near-stores'],
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, store_name, store_phone, store_address, store_lat, store_lng, store_logo, store_hours')
        .eq('is_approved', true)
        .not('store_name', 'is', null);
      return data ?? [];
    },
  });

  if (permError) {
    return (
      <div className="container mx-auto p-8 text-center space-y-4">
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
    .map((s: any) => {
      const distance = s.store_lat && s.store_lng
        ? haversineKm(pos.lat, pos.lng, Number(s.store_lat), Number(s.store_lng))
        : null;
      return { ...s, distance };
    })
    .filter((s: any) => s.distance !== null)
    .sort((a: any, b: any) => a.distance! - b.distance!);

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Vicino a te</h1>
        <p className="text-sm text-gray-500">{ranked.length} negozi ordinati per distanza</p>
      </div>

      <div className="space-y-3">
        {ranked.map((s: any) => {
          const street = streetFromAddress(s.store_address);
          const hours = (s.store_hours ?? {}) as StoreHours;
          const todayKey = DAY_KEYS[new Date().getDay()];
          const open = isOpenNow(hours[todayKey]);
          const distance = s.distance as number;
          return (
            <Link
              key={s.id}
              href={`/store/${s.id}`}
              className="block bg-white border rounded-xl p-4 hover:shadow-md hover:border-indigo-200 transition-all"
            >
              <div className="flex items-center gap-4">
                <StoreAvatar logoUrl={s.store_logo} storeName={s.store_name} size="md" />
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-gray-900">{s.store_name}</p>
                  {street && <p className="text-sm text-gray-500 truncate">📍 {street}</p>}
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ring-1 ${
                      open ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                           : 'bg-gray-100 text-gray-600 ring-gray-200'
                    }`}>
                      {open ? '● Aperto' : '● Chiuso'}
                    </span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-2xl font-bold text-indigo-600">{distance < 1 ? `${Math.round(distance * 1000)}m` : `${distance.toFixed(1)} km`}</p>
                  <p className="text-xs text-gray-400">da te</p>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
