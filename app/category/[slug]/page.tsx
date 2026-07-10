'use client';;
import { use, useRef, useState } from "react";

import Link from 'next/link';
import { safeJsonLd } from '@/lib/html-escape';
import { useQuery } from '@tanstack/react-query';
import { Filter, RotateCcw, Truck, Tag, PackageCheck, CircleDot, Star, X, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { supabase } from '@/lib/supabase/client';
import ProductGrid, { type SortOption } from '@/components/ProductGrid';
import CollectionHeader from '@/components/CollectionHeader';
import { LoadingState } from '@/components/ui/LoadingState';
import { queryKeys } from '@/lib/queries/keys';

export default function CategoryPage(props: { params: Promise<{ slug: string }> }) {
  const params = use(props.params);
  const { slug } = params;
  const t = useTranslations('search');
  const ta = useTranslations('actions');
  const tn = useTranslations('nav');

  const { data: category, isLoading } = useQuery({
    queryKey: queryKeys.categories.bySlug(slug),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('categories')
        .select('id, slug, name, icon, parent_id')
        .eq('slug', slug)
        .single();
      if (error) throw error;
      return data;
    },
  });

  type SubcatRow = { id: string; slug: string; name: string; icon: string | null };
  const { data: subcategories = [], isLoading: subsLoading } = useQuery({
    queryKey: [...queryKeys.categories.all, 'sub', category?.id],
    queryFn: async (): Promise<SubcatRow[]> => {
      if (!category) return [];
      const { data, error } = await supabase
        .from('categories')
        .select('id, slug, name, icon')
        .eq('parent_id', category.id)
        .order('name');
      if (error) throw error;
      return (data ?? []) as SubcatRow[];
    },
    enabled: !!category,
  });

  // Stato filtri — ESCLUSIVAMENTE le dimensioni già supportate da ProductGrid.
  const [maxPrice, setMaxPrice] = useState<number>(500);
  const [minPrice, setMinPrice] = useState<number>(0);
  const [sort, setSort] = useState<SortOption>('relevance');
  const [freeShipping, setFreeShipping] = useState(false);
  const [onlyPromo, setOnlyPromo] = useState(false);
  const [onlyInStock, setOnlyInStock] = useState(false);
  const [onlyOpenStores, setOnlyOpenStores] = useState(false);
  const [minRating, setMinRating] = useState<number>(0);
  const [resultCount, setResultCount] = useState<number | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterTriggerRef = useRef<HTMLButtonElement>(null);

  const reset = () => {
    setMaxPrice(500);
    setMinPrice(0);
    setSort('relevance');
    setFreeShipping(false);
    setOnlyPromo(false);
    setOnlyInStock(false);
    setOnlyOpenStores(false);
    setMinRating(0);
  };

  const activeFilters = [
    minPrice > 0,
    maxPrice < 500,
    freeShipping,
    onlyPromo,
    onlyInStock,
    onlyOpenStores,
    minRating > 0,
    sort !== 'relevance',
  ].filter(Boolean).length;

  if (isLoading) return <LoadingState />;
  if (!category) return <div className="container mx-auto p-8 text-center">Categoria non trovata.</div>;
  // Per le categorie principali aspettiamo le sottocategorie prima di decidere
  // hub vs griglia piatta, così non c'è un flash dal layout sbagliato.
  if (category.parent_id === null && subsLoading) return <LoadingState />;

  // Hub: categoria principale con sottocategorie → una rail scrollabile per ognuna.
  const isHub = category.parent_id === null && subcategories.length > 0;

  // Schema.org BreadcrumbList JSON-LD (Home > Categoria) per rich results Google.
  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: '/' },
      { '@type': 'ListItem', position: 2, name: 'Categorie', item: '/categorie' },
      { '@type': 'ListItem', position: 3, name: category.name, item: `/category/${slug}` },
    ],
  };

  // Chip dei filtri attivi (rimovibili) — solo dimensioni reali della pagina.
  type Chip = { key: string; label: string; clear: () => void };
  const chips: Chip[] = [];
  if (minPrice > 0 && maxPrice < 500) chips.push({ key: 'price', label: t('filterPriceRange', { min: minPrice, max: maxPrice }), clear: () => { setMinPrice(0); setMaxPrice(500); } });
  else if (maxPrice < 500) chips.push({ key: 'pmax', label: t('filterPrice', { max: maxPrice }), clear: () => setMaxPrice(500) });
  else if (minPrice > 0) chips.push({ key: 'pmin', label: t('filterPriceMin', { min: minPrice }), clear: () => setMinPrice(0) });
  if (minRating > 0) chips.push({ key: 'rating', label: t('chip.minRating', { rating: minRating }), clear: () => setMinRating(0) });
  if (freeShipping) chips.push({ key: 'free', label: t('chip.freeShipping'), clear: () => setFreeShipping(false) });
  if (onlyPromo) chips.push({ key: 'promo', label: t('chip.promotion'), clear: () => setOnlyPromo(false) });
  if (onlyInStock) chips.push({ key: 'stock', label: t('chip.inStock'), clear: () => setOnlyInStock(false) });
  if (onlyOpenStores) chips.push({ key: 'open', label: t('chip.openNow'), clear: () => setOnlyOpenStores(false) });
  if (sort !== 'relevance') chips.push({ key: 'sort', label: t(`sort.${sort}`), clear: () => setSort('relevance') });

  // Header serif + breadcrumb condiviso tra hub e griglia — riusa CollectionHeader
  // (stesso componente di novita/regali/promozioni). L'emoji di categoria viene
  // mostrata nel chip terracotta; `Tag` resta il fallback lucide.
  const header = (
    <CollectionHeader
      icon={Tag}
      emoji={category.icon}
      eyebrow="Categoria"
      title={category.name}
      blurb="Esplora i prodotti della categoria dai negozi di Piacenza."
      breadcrumb={[
        { label: tn('home'), href: '/' },
        { label: 'Categorie', href: '/categorie' },
        { label: category.name },
      ]}
    />
  );

  // Controlli filtro condivisi tra colonna desktop e bottom-sheet mobile.
  const filterControls = (
    <div className="divide-y divide-cream-100">
      <div className="pb-3">
        <label className="block">
          <span className="block text-[11px] font-semibold text-ink-500 mb-1 uppercase tracking-wider">{t('sortBy')}</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortOption)}
            className="w-full bg-cream-50 border border-cream-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
          >
            <option value="relevance">{t('sort.relevance')}</option>
            <option value="newest">{t('sort.newest')}</option>
            <option value="price_asc">{t('sort.price_asc')}</option>
            <option value="price_desc">{t('sort.price_desc')}</option>
            <option value="discount_desc">{t('sort.discount_desc')}</option>
            <option value="rating">{t('sort.rating')}</option>
          </select>
        </label>
      </div>

      {/* Range prezzo */}
      <div className="py-3">
        <div className="flex justify-between items-center mb-1.5">
          <span className="text-[11px] font-semibold text-ink-500 uppercase tracking-wider">{t('price')}</span>
          <span className="font-bold text-primary-700 text-xs">€{minPrice} – €{maxPrice}{maxPrice >= 500 ? '+' : ''}</span>
        </div>
        <input
          type="range"
          min={0}
          max={500}
          step={5}
          value={minPrice}
          onChange={(e) => setMinPrice(Math.min(Number(e.target.value), maxPrice - 5))}
          className="w-full accent-primary-600"
          aria-label={t('minPrice')}
        />
        <input
          type="range"
          min={5}
          max={500}
          step={5}
          value={maxPrice}
          onChange={(e) => setMaxPrice(Math.max(Number(e.target.value), minPrice + 5))}
          className="w-full accent-primary-600"
          aria-label={t('maxPrice')}
        />
      </div>

      {/* Rating minimo */}
      <div className="py-3">
        <span className="text-[11px] font-semibold text-ink-500 mb-1.5 uppercase tracking-wider flex items-center gap-1">
          <Star size={11} strokeWidth={2.2} />
          {t('minRating')}
        </span>
        <div className="flex gap-1.5">
          {[0, 3, 4, 4.5].map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setMinRating(r)}
              aria-pressed={minRating === r}
              className={`flex-1 text-xs font-semibold py-1.5 rounded-lg border transition-colors ${
                minRating === r
                  ? 'bg-primary-600 text-white border-primary-600'
                  : 'bg-white text-ink-700 border-cream-300 hover:border-primary-300'
              }`}
            >
              {r === 0 ? t('ratingAll') : `${r}+`}
            </button>
          ))}
        </div>
      </div>

      {/* Checkbox */}
      <div className="pt-3 space-y-2">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={freeShipping} onChange={(e) => setFreeShipping(e.target.checked)} className="accent-primary-600" />
          <Truck size={14} strokeWidth={2.2} className="text-olive-600" />
          <span>{t('freeShipping')}</span>
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={onlyPromo} onChange={(e) => setOnlyPromo(e.target.checked)} className="accent-primary-600" />
          <Tag size={14} strokeWidth={2.2} className="text-secondary-600" />
          <span>{t('promotion')}</span>
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={onlyInStock} onChange={(e) => setOnlyInStock(e.target.checked)} className="accent-primary-600" />
          <PackageCheck size={14} strokeWidth={2.2} className="text-olive-600" />
          <span>{t('inStock')}</span>
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={onlyOpenStores} onChange={(e) => setOnlyOpenStores(e.target.checked)} className="accent-primary-600" />
          <CircleDot size={14} strokeWidth={2.2} className="text-olive-600" />
          <span>{t('openNow')}</span>
        </label>
      </div>
    </div>
  );

  // Categoria padre senza sottocategorie → filtra anche i prodotti delle figlie? No:
  // restiamo sul comportamento storico (categoryId della categoria corrente).
  const gridProps = {
    categoryId: category.id,
    maxPrice: maxPrice < 500 ? maxPrice : undefined,
    minPrice: minPrice > 0 ? minPrice : (freeShipping ? 30 : undefined),
    onlyOpenStores,
    onlyPromo,
    onlyInStock,
    minRating: minRating > 0 ? minRating : undefined,
    sort,
  } as const;

  // Hub: rail per ogni sottocategoria. Mantiene il comportamento storico, ma con
  // header serif + breadcrumb e una riga "Sottocategorie".
  if (isHub) {
    return (
      <div className="container mx-auto px-4 sm:px-6 py-8 space-y-8">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbSchema) }} />
        {header}

        <section>
          <h2 className="font-serif text-xl font-bold text-ink-900 mb-3">Sottocategorie</h2>
          <div className="flex flex-wrap gap-2.5">
            {subcategories.map((s) => (
              <Link
                key={s.id}
                href={`/category/${s.slug}`}
                className="bg-white border border-cream-300 rounded-full px-4 py-2 hover:bg-primary-50 hover:border-primary-400 text-sm font-medium transition-colors"
              >
                {s.name}
              </Link>
            ))}
          </div>
        </section>

        <div className="space-y-10">
          {subcategories.map((s) => (
            <ProductGrid
              key={s.id}
              rail
              limit={12}
              categoryId={s.id}
              title={s.name}
              titleHref={`/category/${s.slug}`}
              seeAllHref={`/category/${s.slug}`}
            />
          ))}
          <ProductGrid rail limit={12} categoryId={category.id} title="Altri prodotti" />
        </div>
      </div>
    );
  }

  // Griglia piatta (categoria foglia o padre senza sottocategorie):
  // header serif + breadcrumb, colonna filtri faccettata (collassabile su mobile),
  // riga conteggio, chip row e zero-results arricchito.
  return (
    <div className="container mx-auto px-4 sm:px-6 py-8 grid grid-cols-1 md:grid-cols-4 gap-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbSchema) }} />

      <div className="md:col-span-4">{header}</div>

      {subcategories.length > 0 && (
        <section className="md:col-span-4">
          <div className="flex flex-wrap gap-2.5">
            {subcategories.map((s) => (
              <Link
                key={s.id}
                href={`/category/${s.slug}`}
                className="bg-white border border-cream-300 rounded-full px-4 py-2 hover:bg-primary-50 hover:border-primary-400 text-sm font-medium transition-colors"
              >
                {s.name}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* DESKTOP: colonna filtri faccettata */}
      <aside className="hidden md:block md:col-span-1 bg-white border border-cream-300 rounded-2xl p-4 h-fit md:sticky md:top-[var(--header-height)] shadow-warm">
        <div className="flex items-center justify-between pb-3 border-b border-cream-100 mb-1">
          <h2 className="font-serif font-bold text-ink-900 flex items-center gap-2">
            <Filter size={16} strokeWidth={2.2} className="text-primary-600" />
            {t('filters')}
            {activeFilters > 0 && (
              <span className="bg-primary-600 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">
                {activeFilters}
              </span>
            )}
          </h2>
          {activeFilters > 0 && (
            <button onClick={reset} className="text-xs text-ink-500 hover:text-primary-700 inline-flex items-center gap-1">
              <RotateCcw size={12} />
              {t('reset')}
            </button>
          )}
        </div>
        {filterControls}
      </aside>

      {/* MOBILE: trigger "Filtri" */}
      <div className="md:hidden flex items-center justify-end">
        <button
          ref={filterTriggerRef}
          onClick={() => setFiltersOpen(true)}
          aria-label={t('filters')}
          aria-expanded={filtersOpen}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold shadow-sm transition-colors ${
            activeFilters > 0
              ? 'bg-primary-600 text-white hover:bg-primary-700'
              : 'bg-white text-primary-700 border border-primary-200 hover:bg-primary-50'
          }`}
        >
          <Filter size={15} strokeWidth={2.4} className={activeFilters > 0 ? 'text-white' : 'text-primary-600'} />
          <span>{t('filters')}</span>
          {activeFilters > 0 && (
            <span className="bg-white text-primary-700 text-[10px] font-extrabold rounded-full min-w-[1.1rem] px-1 py-0.5 leading-none">
              {activeFilters}
            </span>
          )}
        </button>
      </div>

      {/* MOBILE: bottom-sheet filtri */}
      {filtersOpen && (
        <div className="md:hidden fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={t('filters')}>
          <div className="absolute inset-0 bg-black/40" onClick={() => setFiltersOpen(false)} />
          <div className="absolute bottom-0 inset-x-0 bg-white rounded-t-2xl shadow-warm-lg max-h-[85vh] flex flex-col pb-safe">
            <div className="sticky top-0 bg-white flex items-center justify-between px-4 py-3 border-b border-cream-200 rounded-t-2xl">
              <h2 className="font-serif font-bold text-ink-900 flex items-center gap-2">
                <Filter size={16} strokeWidth={2.2} className="text-primary-600" />
                {t('filters')}
                {activeFilters > 0 && (
                  <span className="bg-primary-600 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">
                    {activeFilters}
                  </span>
                )}
              </h2>
              <button onClick={() => setFiltersOpen(false)} aria-label={ta('close')} className="text-ink-400 hover:text-ink-700 p-1">
                <X size={20} />
              </button>
            </div>
            <div className="overflow-y-auto px-4 py-3">{filterControls}</div>
            <div className="border-t border-cream-200 p-3 flex gap-2">
              {activeFilters > 0 && (
                <button
                  onClick={reset}
                  className="flex-1 inline-flex items-center justify-center gap-1 border border-cream-300 text-ink-700 font-semibold py-2.5 rounded-xl"
                >
                  <RotateCcw size={14} /> {t('reset')}
                </button>
              )}
              <button
                onClick={() => setFiltersOpen(false)}
                className="flex-1 bg-primary-600 hover:bg-primary-700 text-white font-bold py-2.5 rounded-xl"
              >
                {t('showResults')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Risultati */}
      <main className="md:col-span-3 space-y-4">
        {/* Riga conteggio */}
        {resultCount !== null && (
          <p className="text-sm text-ink-500">{t('countLine', { count: resultCount })}</p>
        )}

        {/* Chip dei filtri attivi (rimovibili) */}
        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('activeFilters')}>
            {chips.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={c.clear}
                aria-label={t('removeFilter', { label: c.label })}
                className="inline-flex items-center gap-1.5 rounded-full border border-primary-200 bg-primary-50 pl-3 pr-2 py-1 text-[13px] font-semibold text-primary-800 hover:bg-primary-100 transition-colors"
              >
                {c.label}
                <X size={14} strokeWidth={2.4} className="text-primary-700" aria-hidden />
              </button>
            ))}
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-1 px-2 py-1 text-[13px] font-semibold text-ink-500 hover:text-primary-700 transition-colors"
            >
              <RotateCcw size={13} aria-hidden /> {t('clearAll')}
            </button>
          </div>
        )}

        <ProductGrid
          {...gridProps}
          maxColumns={4}
          onCount={setResultCount}
          emptyTitle={t('noResultsGeneric')}
          emptyDescription={activeFilters > 0 ? t('noResultsFiltered') : t('noResultsDescription')}
          onReset={activeFilters > 0 ? reset : undefined}
          emptySuggestions={
            <div className="mt-6 space-y-6">
              {subcategories.length > 0 && (
                <div className="text-center">
                  <p className="mb-2 text-[13px] text-ink-500">{t('didYouMean')}</p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {subcategories.slice(0, 6).map((s) => (
                      <Link
                        key={s.id}
                        href={`/category/${s.slug}`}
                        className="inline-flex items-center gap-1.5 rounded-full border border-primary-200 bg-primary-50 px-3.5 py-1.5 text-[13px] font-semibold text-primary-800 hover:bg-primary-100 transition-colors"
                      >
                        <Search size={13} strokeWidth={2.4} aria-hidden /> {s.name}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
              <div className="border-t border-cream-200 pt-5">
                <ProductGrid rail limit={12} categoryId={category.id} title={t('alsoInteresting')} sort="newest" />
              </div>
            </div>
          }
        />
      </main>
    </div>
  );
}
