'use client';

import { Suspense, useEffect, useRef, useState, type RefObject } from 'react';
import { useSearchParams } from 'next/navigation';
import { Filter, RotateCcw, Truck, CircleDot, Star, ArrowDownAZ, ArrowDownWideNarrow, TrendingUp, X, Tag, PackageCheck, Check } from 'lucide-react';
import ProductGrid from '@/components/ProductGrid';
import SponsoredCarousel from '@/components/SponsoredCarousel';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { LoadingState } from '@/components/ui/LoadingState';
import { queryKeys } from '@/lib/queries/keys';
import { useTranslations } from 'next-intl';

type SortOption = 'relevance' | 'price_asc' | 'price_desc' | 'newest' | 'rating';

const SORT_OPTIONS: SortOption[] = ['relevance', 'newest', 'price_asc', 'price_desc', 'rating'];

// Bottom-sheet mobile: scroll-lock + Esc, focus-trap e ritorno del focus al
// trigger alla chiusura (WCAG 2.1.2 / 2.4.3). Condiviso tra pannello filtri e ordina.
function useBottomSheetA11y(
  open: boolean,
  sheetRef: RefObject<HTMLDivElement | null>,
  triggerRef: RefObject<HTMLButtonElement | null>,
  onClose: () => void,
) {
  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const focusables = () =>
      sheetRef.current
        ? Array.from(
            sheetRef.current.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          ).filter((el) => el.offsetParent !== null)
        : [];
    // All'apertura sposta il focus dentro al pannello.
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab') return;
      const els = focusables();
      if (els.length === 0) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      trigger?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

function SearchInner() {
  const params = useSearchParams();
  const t = useTranslations('search');
  const ta = useTranslations('actions');
  const q = params.get('q') ?? '';
  const [maxPrice, setMaxPrice] = useState<number>(500);
  const [minPrice, setMinPrice] = useState<number>(0);
  const [categoryId, setCategoryId] = useState<string>('');
  const [onlyOpenStores, setOnlyOpenStores] = useState(false);
  const [freeShipping, setFreeShipping] = useState(false);
  const [onlyPromo, setOnlyPromo] = useState(false);
  const [onlyInStock, setOnlyInStock] = useState(false);
  const [minRating, setMinRating] = useState<number>(0);
  const [sort, setSort] = useState<SortOption>('relevance');

  const { data: categories = [] } = useQuery({
    queryKey: queryKeys.categories.allList,
    queryFn: async (): Promise<Array<{ id: string; slug: string; name: string }>> => {
      const { data, error } = await supabase
        .from('categories')
        .select('id, slug, name')
        .order('name');
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; slug: string; name: string }>;
    },
  });

  const reset = () => {
    setCategoryId('');
    setMaxPrice(500);
    setMinPrice(0);
    setOnlyOpenStores(false);
    setFreeShipping(false);
    setOnlyPromo(false);
    setOnlyInStock(false);
    setMinRating(0);
    setSort('relevance');
  };

  const [filtersOpen, setFiltersOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const filterTriggerRef = useRef<HTMLButtonElement>(null);

  const [sortOpen, setSortOpen] = useState(false);
  const sortSheetRef = useRef<HTMLDivElement>(null);
  const sortTriggerRef = useRef<HTMLButtonElement>(null);

  // Mobile bottom-sheet: scroll-lock + Esc, PIÙ focus-trap nel pannello e
  // ritorno del focus al bottone trigger alla chiusura (WCAG 2.1.2 / 2.4.3).
  useBottomSheetA11y(filtersOpen, sheetRef, filterTriggerRef, () => setFiltersOpen(false));
  useBottomSheetA11y(sortOpen, sortSheetRef, sortTriggerRef, () => setSortOpen(false));

  const activeFilters = [
    categoryId && 'categoria',
    minPrice > 0 && 'prezzo min',
    maxPrice < 500 && 'prezzo max',
    onlyOpenStores && 'aperti',
    freeShipping && 'spedizione gratis',
    onlyPromo && 'promozione',
    onlyInStock && 'disponibili',
    minRating > 0 && `rating ${minRating}+`,
    sort !== 'relevance' && 'ordinamento',
  ].filter(Boolean).length;

  // Controlli filtro condivisi tra colonna desktop e bottom-sheet mobile.
  const filterControls = (
    <div className="divide-y divide-cream-100">
      {/* Ordinamento + Categoria */}
      <div className="pb-3 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-1 gap-3">
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
            <option value="rating">{t('sort.rating')}</option>
          </select>
        </label>
        <label className="block">
          <span className="block text-[11px] font-semibold text-ink-500 mb-1 uppercase tracking-wider">{t('category')}</span>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full bg-cream-50 border border-cream-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
          >
            <option value="">{t('allCategories')}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Range prezzo — compatto */}
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
              onClick={() => setMinRating(r)}
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
          <input
            type="checkbox"
            checked={freeShipping}
            onChange={(e) => setFreeShipping(e.target.checked)}
            className="accent-primary-600"
          />
          <Truck size={14} strokeWidth={2.2} className="text-olive-600" />
          <span>{t('freeShipping')}</span>
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={onlyPromo}
            onChange={(e) => setOnlyPromo(e.target.checked)}
            className="accent-primary-600"
          />
          <Tag size={14} strokeWidth={2.2} className="text-secondary-600" />
          <span>{t('promotion')}</span>
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={onlyInStock}
            onChange={(e) => setOnlyInStock(e.target.checked)}
            className="accent-primary-600"
          />
          <PackageCheck size={14} strokeWidth={2.2} className="text-olive-600" />
          <span>{t('inStock')}</span>
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={onlyOpenStores}
            onChange={(e) => setOnlyOpenStores(e.target.checked)}
            className="accent-primary-600"
          />
          <CircleDot size={14} strokeWidth={2.2} className="text-olive-600" />
          <span>{t('openNow')}</span>
        </label>
      </div>
    </div>
  );

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 grid grid-cols-1 md:grid-cols-4 gap-6">
      {/* DESKTOP: colonna filtri */}
      <aside className="hidden md:block md:col-span-1 bg-white border border-cream-300 rounded-2xl p-4 h-fit md:sticky md:top-32 shadow-warm">
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

      {/* MOBILE: azioni "Ordina" + "Filtri", compatte e allineate a destra */}
      <div className="md:hidden flex items-center justify-end gap-2">
        <button
          ref={sortTriggerRef}
          onClick={() => setSortOpen(true)}
          aria-label={t('sortBy')}
          className="inline-flex items-center gap-1.5 rounded-full border border-cream-300 bg-white px-3 py-1.5 text-sm font-semibold text-ink-700 shadow-sm hover:bg-cream-50 transition-colors"
        >
          <ArrowDownWideNarrow size={15} strokeWidth={2.2} className="text-ink-500" />
          <span>{t('sortShort')}</span>
        </button>
        <button
          ref={filterTriggerRef}
          onClick={() => setFiltersOpen(true)}
          aria-label={t('filters')}
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
          <div ref={sheetRef} className="absolute bottom-0 inset-x-0 bg-white rounded-t-2xl shadow-warm-lg max-h-[85vh] flex flex-col pb-safe">
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

      {/* MOBILE: bottom-sheet ordinamento */}
      {sortOpen && (
        <div className="md:hidden fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={t('sortBy')}>
          <div className="absolute inset-0 bg-black/40" onClick={() => setSortOpen(false)} />
          <div ref={sortSheetRef} className="absolute bottom-0 inset-x-0 bg-white rounded-t-2xl shadow-warm-lg max-h-[85vh] flex flex-col pb-safe">
            <div className="sticky top-0 bg-white flex items-center justify-between px-4 py-3 border-b border-cream-200 rounded-t-2xl">
              <h2 className="font-serif font-bold text-ink-900 flex items-center gap-2">
                <ArrowDownWideNarrow size={16} strokeWidth={2.2} className="text-primary-600" />
                {t('sortBy')}
              </h2>
              <button onClick={() => setSortOpen(false)} aria-label={ta('close')} className="text-ink-400 hover:text-ink-700 p-1">
                <X size={20} />
              </button>
            </div>
            <div className="overflow-y-auto px-2 py-2">
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  onClick={() => { setSort(opt); setSortOpen(false); }}
                  aria-pressed={sort === opt}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                    sort === opt ? 'bg-primary-50 text-primary-700' : 'text-ink-700 hover:bg-cream-50'
                  }`}
                >
                  <span>{t(`sort.${opt}`)}</span>
                  {sort === opt && <Check size={16} className="text-primary-600" />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <main className="md:col-span-3 space-y-6">
        <SponsoredCarousel placement="search_top" />
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <h1 className="text-2xl md:text-3xl font-serif font-bold text-ink-900">
            {q ? t.rich('resultsFor', { q, hl: (chunks) => <span className="text-primary-700">{chunks}</span> }) : t('allProducts')}
          </h1>
          {sort !== 'relevance' && (
            <span className="text-sm text-ink-500 inline-flex items-center gap-1">
              {sort === 'price_asc' || sort === 'price_desc' ? <ArrowDownAZ size={14} /> : <TrendingUp size={14} />}
              {t('sortedBy', { label: sort === 'newest' ? t('sort.newest') : sort === 'price_asc' ? t('sort.price_asc') : sort === 'price_desc' ? t('sort.price_desc') : t('sort.rating') })}
            </span>
          )}
        </div>
        <ProductGrid
          search={q || undefined}
          categoryId={categoryId || undefined}
          maxPrice={maxPrice < 500 ? maxPrice : undefined}
          minPrice={minPrice > 0 ? minPrice : (freeShipping ? 30 : undefined)}
          onlyOpenStores={onlyOpenStores}
          onlyPromo={onlyPromo}
          onlyInStock={onlyInStock}
          minRating={minRating > 0 ? minRating : undefined}
          sort={sort}
        />
      </main>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <SearchInner />
    </Suspense>
  );
}
