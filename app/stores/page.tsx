'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import StoreAvatar from '@/components/StoreAvatar';
import {
  DAY_KEYS,
  formatToday,
  isOpenNow,
  streetFromAddress,
  type StoreHours,
} from '@/lib/store-hours';

export default function StoresPage() {
  const { data: stores = [], isLoading } = useQuery({
    queryKey: ['stores'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select(
          'id, store_name, store_phone, store_address, store_lat, store_lng, store_logo, store_hours',
        )
        .eq('is_approved', true)
        .not('store_name', 'is', null)
        .order('store_name');
      if (error) throw error;
      return data ?? [];
    },
  });

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-16 text-center text-gray-500">
        Caricamento...
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Negozi nella tua città</h1>
        <p className="text-gray-500 mt-1">
          {stores.length} {stores.length === 1 ? 'negozio attivo' : 'negozi attivi'}
        </p>
      </div>

      {stores.length === 0 ? (
        <p className="text-gray-500">Nessun negozio approvato ancora.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {stores.map((s: any) => {
            const street = streetFromAddress(s.store_address);
            const hours = (s.store_hours ?? {}) as StoreHours;
            const todayKey = DAY_KEYS[new Date().getDay()];
            const todayIntervals = hours[todayKey];
            const open = isOpenNow(todayIntervals);
            const todayLabel = formatToday(todayIntervals);
            const hasHours = Object.keys(hours).length > 0;

            return (
              <Link
                key={s.id}
                href={`/store/${s.id}`}
                className="group bg-white border border-gray-200 rounded-xl overflow-hidden hover:shadow-md hover:border-indigo-200 transition-all"
              >
                <div className="h-16 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />
                <div className="px-5 pb-5 -mt-8">
                  <div className="ring-4 ring-white rounded-full bg-white inline-block">
                    <StoreAvatar logoUrl={s.store_logo} storeName={s.store_name} size="md" />
                  </div>

                  <h3 className="font-bold text-lg text-gray-900 mt-3 truncate group-hover:text-indigo-600 transition-colors">
                    {s.store_name}
                  </h3>

                  <div className="mt-2 space-y-1.5 text-sm">
                    {street && (
                      <div className="flex items-start gap-1.5 text-gray-600">
                        <span className="text-gray-400">📍</span>
                        <span className="truncate">{street}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 text-gray-600">
                      <span className="text-gray-400">📞</span>
                      <span className="truncate">{s.store_phone}</span>
                    </div>
                  </div>

                  {hasHours && (
                    <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${
                          open
                            ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                            : 'bg-gray-100 text-gray-600 ring-1 ring-gray-200'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            open ? 'bg-emerald-500' : 'bg-gray-400'
                          }`}
                        />
                        {open ? 'Aperto' : 'Chiuso'}
                      </span>
                      <span className="text-xs text-gray-500 truncate">{todayLabel}</span>
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
