'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import ProductGrid from '@/components/ProductGrid';

export default function StorePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const { data: store, isLoading } = useQuery({
    queryKey: ['store', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, store_name, store_phone, store_lat, store_lng, is_approved')
        .eq('id', id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  if (isLoading) return <div className="container mx-auto p-8 text-center">Caricamento...</div>;
  if (!store?.store_name || !store.is_approved) {
    return <div className="container mx-auto p-8 text-center">Negozio non trovato.</div>;
  }

  return (
    <div className="container mx-auto px-6 py-8 space-y-8">
      <header className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl p-8 flex items-center gap-6">
        <div className="w-20 h-20 bg-white/20 rounded-full flex items-center justify-center text-4xl">
          🏪
        </div>
        <div>
          <h1 className="text-3xl font-bold">{store.store_name}</h1>
          <p className="text-indigo-100">📞 {store.store_phone}</p>
          {store.store_lat && store.store_lng && (
            <a
              href={`https://www.google.com/maps?q=${store.store_lat},${store.store_lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-white/90 hover:text-white text-sm underline"
            >
              📍 Apri su Google Maps
            </a>
          )}
        </div>
      </header>

      <section>
        <h2 className="text-2xl font-bold mb-4">Prodotti del negozio</h2>
        <ProductGrid sellerId={store.id} />
      </section>
    </div>
  );
}
