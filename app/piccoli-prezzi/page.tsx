'use client';

import { useState } from 'react';
import { PiggyBank } from 'lucide-react';
import ProductGrid, { type SortOption } from '@/components/ProductGrid';
import CollectionHeader from '@/components/CollectionHeader';
import { useTranslations } from 'next-intl';

/** Opzioni di ordinamento della toolbar collezione (allineate a novita/search). */
const COLLECTION_SORTS: SortOption[] = ['price_asc', 'price_desc', 'relevance', 'newest', 'rating', 'discount_desc'];

export default function PiccoliPrezziPage() {
  const t = useTranslations('search');
  const [sort, setSort] = useState<SortOption>('price_asc');
  const [count, setCount] = useState<number | null>(null);

  return (
    <div className="container mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <CollectionHeader
        icon={PiggyBank}
        eyebrow="Sotto i 10€"
        title="Piccoli prezzi"
        blurb="Buono, locale e leggero sul portafoglio."
        breadcrumb={[{ label: 'Home', href: '/' }, { label: 'Piccoli prezzi' }]}
      >
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-ink-500">
            {count !== null && <><strong className="text-ink-900">{count}</strong> {count === 1 ? 'prodotto' : 'prodotti'}</>}
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
      </CollectionHeader>

      <ProductGrid limit={40} maxPrice={10} sort={sort} maxColumns={4} onCount={setCount} />
    </div>
  );
}
