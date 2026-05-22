'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import StoreAvatar from './StoreAvatar';

const StoreShowcase = () => {
  const { data: stores = [] } = useQuery({
    queryKey: ['stores-showcase'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, store_name, store_phone, store_logo')
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

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
      {stores.map((s: any) => (
        <Link
          key={s.id}
          href={`/store/${s.id}`}
          className="bg-white border rounded-lg p-5 hover:shadow-md transition-all flex items-center gap-4"
        >
          <StoreAvatar logoUrl={s.store_logo} storeName={s.store_name} size="md" />
          <div>
            <h3 className="font-bold text-gray-800">{s.store_name}</h3>
            <p className="text-sm text-gray-500">📞 {s.store_phone}</p>
          </div>
        </Link>
      ))}
    </div>
  );
};

export default StoreShowcase;
