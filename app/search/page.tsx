'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { Filter, RotateCcw, Truck, CircleDot, Star, ArrowDownWideNarrow, X, Tag, PackageCheck, Check, Search, ChevronRight } from 'lucide-react';
import ProductGrid from '@/components/ProductGrid';
import SponsoredCarousel from '@/components/SponsoredCarousel';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { LoadingState } from '@/components/ui/LoadingState';
import { queryKeys } from '@/lib/queries/keys';
import { useBottomSheetA11y } from '@/components/hooks/useBottomSheetA11y';
import { FREE_SHIPPING_THRESHOLD } from '@/lib/constants';
import { useTranslations } from 'next-intl';

type SortOption = 'relevance' | 'price_asc' | 'price_desc' | 'newest' | 'rating' | 'discount_desc';

const SORT_OPTIONS: SortOption[] = ['relevance', 'newest', 'price_asc', 'price_desc', 'discount_desc', 'rating'];

/**
 * 3/9/2026 — DUE TERRACOTTE DIVERSE PER LO STESSO PULSANTE.
 *
 * Il pulsante principale del sito è definito una volta sola, in `components/ui/Button.tsx`:
 * `bg-primary-700 hover:bg-primary-800`, cioè il colore che `app/globals.css` chiama `--color-cta`.
 * Qui dentro i pulsanti pieni erano scritti a mano con la terracotta di un tono più chiaro
 * (`primary-600`): due rossi diversi per lo stesso gesto, nella stessa schermata, uno accanto
 * all'altro. Chi guarda non sa dire perché, ma il sito sembra fatto da due persone che non si
 * parlano — e la fiducia è metà del mestiere di un marketplace.
 *
 * La regola, da qui in avanti: un fondo pieno terracotta su una cosa che si clicca è la terracotta
 * del pulsante principale. Il tono più chiaro resta ai pallini e ai contatori, che pulsanti non
 * sono. La tiene la prova `tests/unit/il-pulsante-principale-ha-una-terracotta-sola.test.ts`, che
 * i colori se li calcola dalla tavolozza vera invece di fidarsi di questo commento.
 */


function SearchInner() {
  const params = useSearchParams();
  const t = useTranslations('search');
  const ta = useTranslations('actions');
  const tn = useTranslations('nav');
  const router = useRouter();
  const q = params.get('q') ?? '';

  /**
   * #118 — I filtri vivono nell'indirizzo, non solo nella memoria della pagina.
   *
   * Prima stavano in uno stato locale: bastava aprire un prodotto e premere
   * Indietro per ritrovare la ricerca azzerata, e il link di una ricerca
   * filtrata mandato a qualcuno apriva tutt'altro. La stessa pagina lo faceva
   * gia' bene per il testo cercato (`q`): qui si applica lo stesso schema al
   * resto.
   */
  const numeroDaUrl = (chiave: string, difetto: number) => {
    const v = Number(params.get(chiave));
    return Number.isFinite(v) && params.get(chiave) !== null ? v : difetto;
  };
  /**
   * 22/8/2026 — IL CURSORE DEL PREZZO SPARAVA UNA RICHIESTA A OGNI SCATTO.
   *
   * Trascinando la manopola da 0 a 200 il valore cambia quaranta volte (lo
   * scatto e' di 5 euro): quaranta chiavi di cache diverse, quaranta richieste
   * al database, e quaranta riscritture dell'indirizzo — cioe' quaranta voci
   * nella cronologia, che rendono il tasto Indietro inutilizzabile.
   *
   * Due stati invece di uno: quello «in corso» muove la manopola e il numero a
   * schermo subito, quello «assestato» si aggiorna 300 millisecondi dopo
   * l'ultimo movimento ed e' l'unico che entra nella ricerca e nell'indirizzo.
   * E' lo stesso schema gia' usato dalla barra di ricerca.
   */
  const [maxPrezzoInCorso, setMaxPrezzoInCorso] = useState<number>(() => numeroDaUrl('max', 500));
  const [minPrezzoInCorso, setMinPrezzoInCorso] = useState<number>(() => numeroDaUrl('min', 0));
  const [maxPrice, setMaxPrice] = useState<number>(() => numeroDaUrl('max', 500));
  const [minPrice, setMinPrice] = useState<number>(() => numeroDaUrl('min', 0));

  useEffect(() => {
    const t = setTimeout(() => {
      setMinPrice(minPrezzoInCorso);
      setMaxPrice(maxPrezzoInCorso);
    }, 300);
    return () => clearTimeout(t);
  }, [minPrezzoInCorso, maxPrezzoInCorso]);
  const [categoryId, setCategoryId] = useState<string>(() => params.get('cat') ?? '');
  const [onlyOpenStores, setOnlyOpenStores] = useState(() => params.get('aperti') === '1');
  const [freeShipping, setFreeShipping] = useState(() => params.get('da30') === '1');
  const [onlyPromo, setOnlyPromo] = useState(() => params.get('promo') === '1');
  const [onlyInStock, setOnlyInStock] = useState(() => params.get('disponibili') === '1');
  const [minRating, setMinRating] = useState<number>(() => numeroDaUrl('stelle', 0));
  const [sort, setSort] = useState<SortOption>(() => (params.get('ordine') as SortOption) ?? 'relevance');

  // #118 — Ogni cambio di filtro riscrive l'indirizzo senza ricaricare la
  // pagina e senza spostare lo scorrimento: cosi' Indietro riporta i filtri di
  // prima e il link si puo' mandare a qualcuno.
  useEffect(() => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (categoryId) p.set('cat', categoryId);
    if (minPrice > 0) p.set('min', String(minPrice));
    if (maxPrice < 500) p.set('max', String(maxPrice));
    if (onlyOpenStores) p.set('aperti', '1');
    if (freeShipping) p.set('da30', '1');
    if (onlyPromo) p.set('promo', '1');
    if (onlyInStock) p.set('disponibili', '1');
    if (minRating > 0) p.set('stelle', String(minRating));
    if (sort !== 'relevance') p.set('ordine', sort);
    const nuovo = p.toString();
    if (nuovo === params.toString()) return;
    router.replace(nuovo ? `/search?${nuovo}` : '/search', { scroll: false });
  }, [q, categoryId, minPrice, maxPrice, onlyOpenStores, freeShipping, onlyPromo, onlyInStock, minRating, sort, params, router]);

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
    setMaxPrezzoInCorso(500);
    setMinPrezzoInCorso(0);
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

  // Conteggio reale dei risultati visibili, sollevato da ProductGrid via onCount.
  const [resultCount, setResultCount] = useState<number | null>(null);

  // Chip dei filtri attivi: ciascuno rimovibile, riflette lo stato reale di
  // filtri/ordinamento/prezzo. La clear di ogni chip tocca solo il proprio stato.
  type Chip = { key: string; label: string; clear: () => void };
  const categoryName = categories.find((c) => c.id === categoryId)?.name;
  const chips: Chip[] = [];
  if (categoryId) chips.push({ key: 'cat', label: t('filterCategory', { name: categoryName ?? '' }), clear: () => setCategoryId('') });
  if (minPrice > 0 && maxPrice < 500) chips.push({ key: 'price', label: t('filterPriceRange', { min: minPrice, max: maxPrice }), clear: () => { setMinPrice(0); setMaxPrice(500); setMinPrezzoInCorso(0); setMaxPrezzoInCorso(500); } });
  else if (maxPrice < 500) chips.push({ key: 'pmax', label: t('filterPrice', { max: maxPrice }), clear: () => { setMaxPrice(500); setMaxPrezzoInCorso(500); } });
  else if (minPrice > 0) chips.push({ key: 'pmin', label: t('filterPriceMin', { min: minPrice }), clear: () => { setMinPrice(0); setMinPrezzoInCorso(0); } });
  if (minRating > 0) chips.push({ key: 'rating', label: t('chip.minRating', { rating: minRating }), clear: () => setMinRating(0) });
  if (freeShipping) chips.push({ key: 'free', label: t('chip.freeShipping'), clear: () => setFreeShipping(false) });
  if (onlyPromo) chips.push({ key: 'promo', label: t('chip.promotion'), clear: () => setOnlyPromo(false) });
  if (onlyInStock) chips.push({ key: 'stock', label: t('chip.inStock'), clear: () => setOnlyInStock(false) });
  if (onlyOpenStores) chips.push({ key: 'open', label: t('chip.openNow'), clear: () => setOnlyOpenStores(false) });
  if (sort !== 'relevance') chips.push({ key: 'sort', label: t(`sort.${sort}`), clear: () => setSort('relevance') });

  // "Forse cercavi": categorie reali (già caricate da Supabase) come scorciatoie.
  const didYouMean = categories.slice(0, 6);

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
            className="w-full bg-cream-50 border border-cream-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-700"
          >
            <option value="relevance">{t('sort.relevance')}</option>
            <option value="newest">{t('sort.newest')}</option>
            <option value="price_asc">{t('sort.price_asc')}</option>
            <option value="price_desc">{t('sort.price_desc')}</option>
            <option value="discount_desc">{t('sort.discount_desc')}</option>
            <option value="rating">{t('sort.rating')}</option>
          </select>
        </label>
        <label className="block">
          <span className="block text-[11px] font-semibold text-ink-500 mb-1 uppercase tracking-wider">{t('category')}</span>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full bg-cream-50 border border-cream-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-700"
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
          <span className="font-bold text-primary-700 text-xs">€{minPrezzoInCorso} – €{maxPrezzoInCorso}{maxPrezzoInCorso >= 500 ? '+' : ''}</span>
        </div>
        <input
          type="range"
          min={0}
          max={500}
          step={5}
          value={minPrezzoInCorso}
          onChange={(e) => setMinPrezzoInCorso(Math.min(Number(e.target.value), maxPrezzoInCorso - 5))}
          className="w-full accent-primary-600"
          aria-label={t('minPrice')}
        />
        <input
          type="range"
          min={5}
          max={500}
          step={5}
          value={maxPrezzoInCorso}
          onChange={(e) => setMaxPrezzoInCorso(Math.max(Number(e.target.value), minPrezzoInCorso + 5))}
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
                  ? 'bg-primary-700 text-white border-primary-700'
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
              ? 'bg-primary-700 text-white hover:bg-primary-800'
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
                className="flex-1 bg-primary-700 hover:bg-primary-800 text-white font-bold py-2.5 rounded-xl"
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

      {/* 148 — Il layout dell'applicazione ha già un <main>: questo secondo,
          annidato dentro il primo, rompe la navigazione per landmark — chi usa
          un lettore di schermo salta al «contenuto principale» e ne trova due. */}
      <div className="md:col-span-3 space-y-6">
        <SponsoredCarousel placement="search_top" />
        <div className="space-y-3">
          {/* Breadcrumb accessibile: Home › Ricerca */}
          <nav aria-label="Breadcrumb">
            <ol className="flex flex-wrap items-center gap-1.5 text-[13px] text-ink-500">
              <li className="inline-flex items-center gap-1.5">
                <Link href="/" className="hover:text-ink-700 transition-colors">{tn('home')}</Link>
                <ChevronRight size={13} className="text-ink-400 shrink-0" aria-hidden />
              </li>
              <li>
                <span className="text-ink-700" aria-current="page">{tn('search')}</span>
              </li>
            </ol>
          </nav>

          <h1 className="text-2xl md:text-3xl font-serif font-bold text-ink-900">
            {q ? t.rich('resultsFor', { q, hl: (chunks) => <span className="text-primary-700">{chunks}</span> }) : t('allProducts')}
          </h1>

          {/* Riga risultati: conteggio a sinistra + select "Ordina per" attivo a destra (desktop) */}
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            {/* 144 — Cambiando un filtro il numero di risultati cambiava in
                silenzio: chi non vede la pagina non sapeva se il filtro avesse
                fatto qualcosa. Ora la riga si annuncia da sola. */}
            <p role="status" aria-live="polite" className="text-sm text-ink-500">
              {resultCount !== null ? t('countLine', { count: resultCount }) : ''}
            </p>
            <label className="hidden md:inline-flex items-center gap-2 text-[13px] text-ink-500">
              {t('sortBy')}
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortOption)}
                aria-label={t('sortBy')}
                className="bg-cream-50 border border-cream-300 rounded-lg px-2.5 py-1.5 text-[13px] font-semibold text-ink-900 focus:outline-none focus:ring-2 focus:ring-primary-700 cursor-pointer"
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>{t(`sort.${opt}`)}</option>
                ))}
              </select>
            </label>
          </div>

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
        </div>

        <ProductGrid
          search={q || undefined}
          categoryId={categoryId || undefined}
          maxPrice={maxPrice < 500 ? maxPrice : undefined}
          // #117 — I due filtri si sommano invece di escludersi: prima, con un
          // prezzo minimo impostato, la spunta da-30-in-su non faceva piu'
          // niente, restava accesa e contava fra i filtri attivi.
          minPrice={Math.max(minPrice, freeShipping ? FREE_SHIPPING_THRESHOLD : 0) || undefined}
          onlyOpenStores={onlyOpenStores}
          onlyPromo={onlyPromo}
          onlyInStock={onlyInStock}
          minRating={minRating > 0 ? minRating : undefined}
          sort={sort}
          onCount={setResultCount}
          emptyTitle={q ? t('noResultsTitle', { q }) : t('noResultsGeneric')}
          emptyDescription={activeFilters > 0 ? t('noResultsFiltered') : t('noResultsDescription')}
          onReset={activeFilters > 0 ? reset : undefined}
          emptySuggestions={
            <div className="mt-6 space-y-6">
              {didYouMean.length > 0 && (
                <div className="text-center">
                  <p className="mb-2 text-[13px] text-ink-500">{t('didYouMean')}</p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {didYouMean.map((c) => (
                      <Link
                        key={c.id}
                        href={`/category/${c.slug}`}
                        className="inline-flex items-center gap-1.5 rounded-full border border-primary-200 bg-primary-50 px-3.5 py-1.5 text-[13px] font-semibold text-primary-800 hover:bg-primary-100 transition-colors"
                      >
                        <Search size={13} strokeWidth={2.4} aria-hidden /> {c.name}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
              <div className="border-t border-cream-200 pt-5">
                <ProductGrid rail limit={12} title={t('alsoInteresting')} sort="newest" />
              </div>
            </div>
          }
        />
      </div>
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
