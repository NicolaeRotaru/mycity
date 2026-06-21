'use client';

import { useState } from 'react';
import { Gift } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import ProductGrid, { type SortOption } from '@/components/ProductGrid';
import CollectionHeader from '@/components/CollectionHeader';
import { useTranslations } from 'next-intl';
import { supabase } from '@/lib/supabase/client';
import { queryKeys } from '@/lib/queries/keys';

/** Opzioni di ordinamento della toolbar collezione (allineate a search/category). */
const COLLECTION_SORTS: SortOption[] = ['relevance', 'newest', 'price_asc', 'price_desc', 'discount_desc'];

/**
 * Prezzo minimo "da regalo": esclude gli articoli troppo economici per essere
 * un pensiero. Soglia conservativa; resta il filtro di base anche se la
 * mappatura della tassonomia non è affidabile.
 */
const GIFT_MIN_PRICE = 12;

/**
 * Slug "regalabili" della tassonomia live. Categorie che hanno senso come idea
 * regalo; usate solo se trovate davvero a DB (altrimenti niente filtro categoria
 * → fallback al solo minPrice, nessuna collezione vuota artificiale).
 */
const GIFT_CATEGORY_SLUGS = new Set([
  'bellezza', 'alimentari', 'casa', 'casa-cucina', 'cucina',
  'giocattoli', 'libri', 'abbigliamento',
]);
/** Parole-chiave nei nomi categoria (fallback se gli slug non combaciano). */
const GIFT_NAME_HINTS = ['regal', 'bellezza', 'gourmet', 'vino', 'cioccolat', 'profum', 'gioiell', 'fiori', 'artigian'];

/** Corpo interattivo della pagina "Regali": header serif + toolbar + griglia filtrata. */
export default function RegaliClient() {
  const t = useTranslations('search');
  const [sort, setSort] = useState<SortOption>('newest');
  const [count, setCount] = useState<number | null>(null);

  // Categorie regalabili dalla tassonomia LIVE: match per slug, poi per nome.
  // Se nessuna combacia, restiamo sul solo minPrice (filtro robusto, mai vuoto
  // per colpa di una mappatura sbagliata).
  const { data: giftCategoryIds = [] } = useQuery({
    queryKey: [...queryKeys.categories.all, 'regali'],
    staleTime: 30 * 60 * 1000,
    queryFn: async (): Promise<string[]> => {
      const { data } = await supabase.from('categories').select('id, slug, name');
      const rows = (data ?? []) as { id: string; slug: string | null; name: string | null }[];
      const matched = rows.filter((c) => {
        const slug = (c.slug ?? '').toLowerCase();
        const name = (c.name ?? '').toLowerCase();
        return GIFT_CATEGORY_SLUGS.has(slug) || GIFT_NAME_HINTS.some((h) => name.includes(h));
      });
      return matched.map((c) => c.id);
    },
  });

  return (
    <div className="container mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <CollectionHeader
        icon={Gift}
        eyebrow="Idee regalo"
        title="Regali"
        blurb="Pensieri buoni e artigianali, da Piacenza con gusto."
        breadcrumb={[{ label: 'Home', href: '/' }, { label: 'Regali' }]}
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

      <ProductGrid
        limit={40}
        sort={sort}
        maxColumns={4}
        onCount={setCount}
        minPrice={GIFT_MIN_PRICE}
        categoryIds={giftCategoryIds.length > 0 ? giftCategoryIds : undefined}
      />
    </div>
  );
}
