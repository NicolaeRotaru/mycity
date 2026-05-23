'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import ProductCard from '@/components/ProductCard';

export default function FavoritesPage() {
  const { data: products = [], isLoading } = useQuery({
    queryKey: ['favorites-products'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data } = await supabase
        .from('favorites')
        .select(`
          product_id,
          products (
            id, name, description, price, images, stock, created_at, seller_id,
            profiles!products_seller_id_fkey ( store_name )
          )
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      return (data ?? [])
        .map((f: any) => f.products)
        .filter(Boolean);
    },
  });

  if (isLoading) return <div className="container mx-auto p-8 text-center text-gray-500">Caricamento...</div>;

  if (products.length === 0) {
    return (
      <div className="container mx-auto p-8 text-center space-y-4">
        <p className="text-5xl">♡</p>
        <p className="text-gray-500 text-lg">Nessun preferito ancora.</p>
        <p className="text-gray-400 text-sm">Tocca il cuoricino su un prodotto per salvarlo qui.</p>
        <Link href="/" className="inline-block bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg">
          Scopri i prodotti
        </Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">I tuoi preferiti ({products.length})</h1>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
        {products.map((p: any) => (
          <ProductCard
            key={p.id}
            id={p.id}
            name={p.name}
            description={p.description ?? ''}
            price={Number(p.price)}
            images={Array.isArray(p.images) ? p.images : []}
            stock={p.stock}
            createdAt={p.created_at}
            storeName={p.profiles?.store_name ?? undefined}
            sellerId={p.seller_id ?? undefined}
          />
        ))}
      </div>
    </div>
  );
}
