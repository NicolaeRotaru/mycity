'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Heart } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import ProductCard from '@/components/ProductCard';
import EmptyState from '@/components/EmptyState';
import ErrorState from '@/components/ErrorState';
import { LoadingState } from '@/components/ui/LoadingState';
import { queryKeys } from '@/lib/queries/keys';

export default function FavoritesPage() {
  const { data: products = [], isLoading, isError, refetch } = useQuery({
    queryKey: [...queryKeys.favorites.all, 'products'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
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
      if (error) throw error;
      type FavRow = {
        product_id: string;
        products: {
          id: string; name: string; description: string | null;
          price: string | number; images: string[] | null; stock: number | null;
          created_at: string; seller_id: string; status: string;
          profiles: { store_name: string | null; is_approved: boolean } | null;
        } | null;
      };
      // Filtra i preferiti il cui negozio è sospeso/non approvato o il
      // prodotto è stato venduto/disabilitato.
      return ((data ?? []) as unknown as FavRow[])
        .map((f) => f.products)
        .filter((p): p is NonNullable<FavRow['products']> =>
          !!p && !!p.profiles?.is_approved && p.status === 'available');
    },
  });

  if (isLoading) return <LoadingState />;

  if (isError) {
    return (
      <div className="py-8">
        <ErrorState
          title="Impossibile caricare i preferiti"
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="py-8">
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
    <div>
      <header className="mb-6">
        <p className="text-xs font-bold uppercase tracking-[0.05em] text-primary-700">Attività</p>
        <h1 className="mt-0.5 font-serif text-3xl font-extrabold leading-tight text-ink-900 sm:text-[32px]">
          I tuoi preferiti
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          {products.length === 1 ? '1 prodotto salvato' : `${products.length} prodotti salvati`}
        </p>
      </header>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {products.map((p) => (
          <ProductCard
            key={p.id}
            id={p.id}
            name={p.name}
            description={p.description ?? ''}
            price={Number(p.price)}
            images={Array.isArray(p.images) ? p.images : []}
            stock={p.stock ?? undefined}
            createdAt={p.created_at}
            storeName={p.profiles?.store_name ?? undefined}
            sellerId={p.seller_id ?? undefined}
          />
        ))}
      </div>
    </div>
  );
}
