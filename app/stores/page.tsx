'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';

export default function StoresPage() {
  const { data: stores = [], isLoading } = useQuery({
    queryKey: ['stores'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, store_name, store_phone, store_lat, store_lng')
        .eq('is_approved', true)
        .not('store_name', 'is', null)
        .order('store_name');
      if (error) throw error;
      return data ?? [];
    },
  });

  if (isLoading) return <div className="container mx-auto p-8 text-center">Caricamento...</div>;

  return (
    <div className="container mx-auto px-6 py-8">
      <h1 className="text-3xl font-bold mb-6">Negozi a Piacenza</h1>
      {stores.length === 0 ? (
        <p className="text-gray-500">Nessun negozio approvato ancora.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {stores.map((s: any) => (
            <Link
              key={s.id}
              href={`/store/${s.id}`}
              className="bg-white border rounded-lg p-6 hover:shadow-lg transition-shadow space-y-2"
            >
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center text-2xl">
                  🏪
                </div>
                <h3 className="font-bold text-lg">{s.store_name}</h3>
              </div>
              <p className="text-sm text-gray-500">📞 {s.store_phone}</p>
              {s.store_lat && s.store_lng && (
                <span className="text-sm text-indigo-600 inline-block">
                  📍 {Number(s.store_lat).toFixed(4)}, {Number(s.store_lng).toFixed(4)}
                </span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
