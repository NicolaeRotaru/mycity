'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Flame } from 'lucide-react';
import ProductGrid, { type SortOption } from '@/components/ProductGrid';
import CollectionHeader from '@/components/CollectionHeader';
import { useTranslations } from 'next-intl';

/** Opzioni di ordinamento della toolbar collezione (allineate a novita/search). */
const COLLECTION_SORTS: SortOption[] = ['rating', 'relevance', 'newest', 'price_asc', 'price_desc', 'discount_desc'];

/**
 * 5/11/2026 — La pagina si chiamava «I più venduti · Quello che va forte questa
 * settimana», ma nessun dato di vendita la ordina: la griglia mette in testa i
 * prodotti con più recensioni. Il titolo ora dice quello che la griglia fa. Il
 * giorno che ci saranno vendite vere da contare, la classifica per venduto
 * della settimana è una funzione nuova, e il titolo potrà tornare.
 */
export default function PiuVendutiPage() {
  const t = useTranslations('search');
  const [sort, setSort] = useState<SortOption>('rating');
  const [count, setCount] = useState<number | null>(null);

  return (
    <div className="container mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <CollectionHeader
        icon={Flame}
        eyebrow="Scelti dai clienti"
        title="I più recensiti"
        blurb="I prodotti ordinati per numero di recensioni dei clienti."
        breadcrumb={[{ label: 'Home', href: '/' }, { label: 'Più recensiti' }]}
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
              className="cursor-pointer rounded-lg border border-cream-300 bg-white px-3 py-2 text-[13px] font-semibold text-ink-900 focus:outline-none focus:ring-2 focus:ring-primary-700"
            >
              {COLLECTION_SORTS.map((opt) => (
                <option key={opt} value={opt}>{t(`sort.${opt}`)}</option>
              ))}
            </select>
          </label>
        </div>
      </CollectionHeader>

      <ProductGrid
        soloRecensiti
        limit={40}
        sort={sort}
        maxColumns={4}
        onCount={setCount}
        titoloNascosto="I prodotti più recensiti"
        emptyTitle="Ancora nessun prodotto recensito"
        emptyDescription="Appena i clienti scriveranno le prime recensioni, i prodotti più recensiti compariranno qui. Intanto puoi sfogliare tutto il catalogo."
        emptySuggestions={
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <Link href="/search" className="rounded-full bg-primary-700 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-800">
              Sfoglia tutti i prodotti
            </Link>
            <Link href="/categorie" className="rounded-full border border-cream-300 px-4 py-2 text-sm font-semibold text-ink-800 hover:border-primary-400">
              Vai alle categorie
            </Link>
          </div>
        }
      />
    </div>
  );
}
