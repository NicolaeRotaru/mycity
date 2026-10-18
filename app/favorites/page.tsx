'use client';

import { useQuery } from '@tanstack/react-query';
import { Heart } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import ProductCard from '@/components/ProductCard';
import EmptyState from '@/components/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { LoadingState } from '@/components/ui/LoadingState';
import { queryKeys } from '@/lib/queries/keys';
import { leggiPreferiti } from '@/lib/queries/preferiti';

export default function FavoritesPage() {
  const { data: products = [], isLoading, isError, refetch } = useQuery({
    queryKey: [...queryKeys.favorites.all, 'products'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      // 15/10/2026 (R3) — La lettura vive in lib/queries/preferiti.ts: agganciava il
      // negozio a `profiles`, e dopo la migrazione 161 la pagina si svuotava per ogni cliente.
      return leggiPreferiti(supabase, user.id);
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
            hasVariants={p.has_variants ?? undefined}
            createdAt={p.created_at}
            storeName={p.profiles?.store_name ?? undefined}
            sellerId={p.seller_id ?? undefined}
          />
        ))}
      </div>
    </div>
  );
}
