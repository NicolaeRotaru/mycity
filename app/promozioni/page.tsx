'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Tag } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { supabase } from '@/lib/supabase/client';
import ProductCard from '@/components/ProductCard';
import ProductGrid, { type SortOption } from '@/components/ProductGrid';
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

/** Opzioni di ordinamento della toolbar collezione (allineate a search/category). */
const COLLECTION_SORTS: SortOption[] = ['relevance', 'price_asc', 'price_desc', 'discount_desc'];

/**
 * Pagina pubblica "Promozioni": tutti i prodotti del marketplace che hanno
 * uno sconto attivo. Collegata dalla CategoryBar e dalla sezione home.
 */
export default function PromozioniPage() {
  const t = useTranslations('search');
  const [sort, setSort] = useState<SortOption>('discount_desc');

  const { data: items = [], isLoading } = useQuery({
    queryKey: queryKeys.promotions.active,
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase.rpc('active_promo_products', { p_limit: 60 });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  // Ordinamento client-side sulle righe RPC (la pagina ha il proprio data path,
  // così conserviamo i badge sconto per riga). Vocabolario allineato a search.
  const sorted = useMemo(() => {
    const arr = [...items];
    switch (sort) {
      case 'price_asc':     return arr.sort((a, b) => Number(a.price) - Number(b.price));
      case 'price_desc':    return arr.sort((a, b) => Number(b.price) - Number(a.price));
      case 'discount_desc': return arr.sort((a, b) => (b.discount_percent || 0) - (a.discount_percent || 0));
      default:              return arr;
    }
  }, [items, sort]);

  return (
    <div className="container mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <CollectionHeader
        icon={Tag}
        eyebrow="In offerta"
        title="Promozioni"
        blurb="Sconti veri dai negozi della tua via."
        breadcrumb={[{ label: 'Home', href: '/' }, { label: 'Promozioni' }]}
      >
        {!isLoading && items.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-ink-500">
              <strong className="text-ink-900">{sorted.length}</strong> {sorted.length === 1 ? 'prodotto' : 'prodotti'}
            </span>
            <label className="inline-flex items-center gap-2 text-[13px] text-ink-500">
              {t('sortBy')}
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortOption)}
                className="cursor-pointer rounded-lg border border-cream-300 bg-white px-3 py-2 text-[13px] font-semibold text-ink-900 focus:outline-none focus:ring-2 focus:ring-primary-400"
              >
                {COLLECTION_SORTS.map((opt) => (
                  <option key={opt} value={opt}>{t(`sort.${opt}`)}</option>
                ))}
              </select>
            </label>
          </div>
        )}
      </CollectionHeader>

      {isLoading ? (
        <SkeletonGrid count={12} />
      ) : items.length === 0 ? (
        // Stato vuoto arricchito (serif) riutilizzato da ProductGrid: con onlyPromo
        // e nessuna promo attiva, ProductGrid rende il proprio blocco vuoto coerente.
        <ProductGrid
          onlyPromo
          maxColumns={4}
          emptyTitle="Nessuna promozione attiva al momento"
          emptyDescription="Torna a trovarci: i negozi lanciano sconti a tempo di continuo."
        />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {sorted.map((it, i) => (
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
