'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Heart } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import ProductCard from '@/components/ProductCard';
import EmptyState from '@/components/EmptyState';
import { LoadingState } from '@/components/ui/LoadingState';
import { queryKeys } from '@/lib/queries/keys';

export default function FavoritesPage() {
  const { data: products = [], isLoading } = useQuery({
    queryKey: [...queryKeys.favorites.all, 'products'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data } = await supabase
        .from('favorites')
        .select(`
          product_id,
          products (
            id, name, description, price, images, stock, created_at, seller_id, status,
            profiles!products_seller_id_fkey ( store_name, is_approved )
          )
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      // Filtra i preferiti il cui negozio è sospeso/non approvato o il
      // prodotto è stato venduto/disabilitato.
      return (data ?? [])
        .map((f: any) => f.products)
        .filter((p: any) => p && p.profiles?.is_approved && p.status === 'available');
    },
  });

  if (isLoading) return <LoadingState />;

  if (products.length === 0) {
    return (
      <div className="container mx-auto py-12 max-w-2xl">
        <EmptyState
          icon={Heart}
          title="Nessun preferito ancora"
          description="Tocca il cuoricino su un prodotto per salvarlo qui e ritrovarlo dopo."
          ctaLabel="Esplora i prodotti"
          ctaHref="/search"
          secondaryLabel="Negozi vicini"
          secondaryHref="/near"
        />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <h1 className="text-2xl font-bold text-ink-900 mb-6">I tuoi preferiti ({products.length})</h1>
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
