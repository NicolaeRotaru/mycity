'use client';

import { useQuery } from '@tanstack/react-query';
import { Tag, SearchX } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import ProductCard from '@/components/ProductCard';
import CollectionHeader from '@/components/CollectionHeader';
import { SkeletonGrid } from '@/components/SkeletonCard';
import { queryKeys } from '@/lib/queries/keys';

type Row = {
  product_id: string;
  name: string;
  price: number | string;
  images: string[] | null;
  seller_id: string | null;
  store_name: string | null;
  discount_percent: number;
};

/**
 * Pagina pubblica "Promozioni": tutti i prodotti del marketplace che hanno
 * uno sconto attivo. Collegata dalla CategoryBar e dalla sezione home.
 */
export default function PromozioniPage() {
  const { data: items = [], isLoading } = useQuery({
    queryKey: queryKeys.promotions.active,
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase.rpc('active_promo_products', { p_limit: 60 });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  return (
    <div className="container mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <CollectionHeader
        icon={Tag}
        eyebrow="In offerta"
        title="Promozioni"
        blurb="Sconti veri dai negozi della tua via."
        breadcrumb={[{ label: 'Home', href: '/' }, { label: 'Promozioni' }]}
      />

      {isLoading ? (
        <SkeletonGrid count={12} />
      ) : items.length === 0 ? (
        <div className="text-center py-16 bg-white border border-cream-300 rounded-xl">
          <SearchX size={48} strokeWidth={1.5} className="mx-auto text-ink-300 mb-3" />
          <p className="text-ink-700 font-semibold mb-1">Nessuna promozione attiva al momento</p>
          <p className="text-sm text-ink-400">Torna a trovarci: i negozi lanciano sconti a tempo di continuo.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {items.map((it, i) => (
            <ProductCard
              key={it.product_id}
              id={it.product_id}
              name={it.name}
              price={Number(it.price)}
              images={Array.isArray(it.images) ? it.images : []}
              storeName={it.store_name ?? undefined}
              sellerId={it.seller_id ?? undefined}
              discountPercent={it.discount_percent}
              priority={i < 6}
            />
          ))}
        </div>
      )}
    </div>
  );
}
