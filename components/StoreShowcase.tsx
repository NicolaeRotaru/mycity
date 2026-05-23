'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import StoreAvatar from './StoreAvatar';
import { DAY_KEYS, isOpenNow, type StoreHours } from '@/lib/store-hours';

const StoreShowcase = () => {
  const { data: stores = [] } = useQuery({
    queryKey: ['stores-showcase'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, store_name, store_phone, store_logo, store_hours')
        .eq('is_approved', true)
        .not('store_name', 'is', null)
        .limit(6);
      if (error) throw error;
      return data ?? [];
    },
  });

  if (stores.length === 0) {
    return <p className="text-gray-500 text-sm">Nessun negozio approvato ancora.</p>;
  }

  const todayKey = DAY_KEYS[new Date().getDay()];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
      {stores.map((s: any) => {
        const hours = (s.store_hours ?? {}) as StoreHours;
        const open = isOpenNow(hours[todayKey]);
        return (
          <Link
            key={s.id}
            href={`/store/${s.id}`}
            className="bg-white border rounded-lg p-5 hover:shadow-md transition-all flex items-center gap-4"
          >
            <StoreAvatar logoUrl={s.store_logo} storeName={s.store_name} size="md" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-gray-800 truncate">{s.store_name}</h3>
              </div>
              <p className="text-xs text-gray-500 truncate">📞 {s.store_phone}</p>
              <span className={`inline-flex items-center gap-1 mt-1 text-[11px] font-medium px-2 py-0.5 rounded-full ring-1 ${
                open ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                     : 'bg-gray-100 text-gray-600 ring-gray-200'
              }`}>
                <span>●</span>{open ? 'Aperto ora' : 'Chiuso'}
              </span>
            </div>
          </Link>
        );
      })}
    </div>
  );
};

export default StoreShowcase;
