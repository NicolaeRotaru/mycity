'use client';

import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import ProductGrid, { type SortOption } from '@/components/ProductGrid';
import CollectionHeader from '@/components/CollectionHeader';
import { useTranslations } from 'next-intl';

/** Opzioni di ordinamento della toolbar collezione (allineate a search/category). */
const COLLECTION_SORTS: SortOption[] = ['relevance', 'newest', 'price_asc', 'price_desc', 'discount_desc'];

/**
 * Pagina "Novità": gli ultimi prodotti pubblicati nel marketplace.
 */
export default function NovitaPage() {
  const t = useTranslations('search');
  const [sort, setSort] = useState<SortOption>('newest');
  const [count, setCount] = useState<number | null>(null);

  return (
    <div className="container mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <CollectionHeader
        icon={Sparkles}
        eyebrow="Appena arrivati"
        title="Novità dai negozi"
        blurb="I prodotti più freschi pubblicati dai commercianti di Piacenza."
        breadcrumb={[{ label: 'Home', href: '/' }, { label: 'Novità' }]}
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

      <ProductGrid sort={sort} maxColumns={4} onCount={setCount} />
    </div>
  );
}
