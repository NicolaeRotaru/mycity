'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Filter, RotateCcw, Truck, CircleDot, Star, ArrowDownAZ, TrendingUp } from 'lucide-react';
import ProductGrid from '@/components/ProductGrid';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';

type SortOption = 'relevance' | 'price_asc' | 'price_desc' | 'newest' | 'rating';

function SearchInner() {
  const params = useSearchParams();
  const q = params.get('q') ?? '';
  const [maxPrice, setMaxPrice] = useState<number>(500);
  const [minPrice, setMinPrice] = useState<number>(0);
  const [categoryId, setCategoryId] = useState<string>('');
  const [onlyOpenStores, setOnlyOpenStores] = useState(false);
  const [freeShipping, setFreeShipping] = useState(false);
  const [minRating, setMinRating] = useState<number>(0);
  const [sort, setSort] = useState<SortOption>('relevance');

  const { data: categories = [] } = useQuery({
    queryKey: ['all-categories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('categories')
        .select('id, slug, name')
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
  });

  const reset = () => {
    setCategoryId('');
    setMaxPrice(500);
    setMinPrice(0);
    setOnlyOpenStores(false);
    setFreeShipping(false);
    setMinRating(0);
    setSort('relevance');
  };

  const activeFilters = [
    categoryId && 'categoria',
    minPrice > 0 && 'prezzo min',
    maxPrice < 500 && 'prezzo max',
    onlyOpenStores && 'aperti',
    freeShipping && 'spedizione gratis',
    minRating > 0 && `rating ${minRating}+`,
    sort !== 'relevance' && 'ordinamento',
  ].filter(Boolean).length;

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 grid grid-cols-1 md:grid-cols-4 gap-6">
      <aside className="md:col-span-1 bg-white border border-cream-300 rounded-2xl p-5 h-fit space-y-5 md:sticky md:top-32 shadow-warm">
        <div className="flex items-center justify-between">
          <h2 className="font-serif font-bold text-ink-900 flex items-center gap-2">
            <Filter size={18} strokeWidth={2.2} className="text-primary-600" />
            Filtri
            {activeFilters > 0 && (
              <span className="bg-primary-600 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">
                {activeFilters}
              </span>
            )}
          </h2>
          {activeFilters > 0 && (
            <button onClick={reset} className="text-xs text-ink-500 hover:text-primary-700 inline-flex items-center gap-1">
              <RotateCcw size={12} />
              Reset
            </button>
          )}
        </div>

        {/* Ordinamento */}
        <div>
          <label className="block text-xs font-semibold text-ink-700 mb-1.5 uppercase tracking-wider">Ordina per</label>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortOption)}
            className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
          >
            <option value="relevance">Rilevanza</option>
            <option value="newest">Più recenti</option>
            <option value="price_asc">Prezzo crescente</option>
            <option value="price_desc">Prezzo decrescente</option>
            <option value="rating">Più recensiti</option>
          </select>
        </div>

        {/* Categoria */}
        <div>
          <label className="block text-xs font-semibold text-ink-700 mb-1.5 uppercase tracking-wider">Categoria</label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
          >
            <option value="">Tutte le categorie</option>
            {categories.map((c: any) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        {/* Range prezzo */}
        <div>
          <div className="flex justify-between text-sm mb-2">
            <label className="text-xs font-semibold text-ink-700 uppercase tracking-wider">Prezzo</label>
            <span className="font-bold text-primary-700 text-xs">€{minPrice} - €{maxPrice}{maxPrice >= 500 ? '+' : ''}</span>
          </div>
          <div className="space-y-2">
            <div>
              <input
                type="range"
                min={0}
                max={500}
                step={5}
                value={minPrice}
                onChange={(e) => setMinPrice(Math.min(Number(e.target.value), maxPrice - 5))}
                className="w-full accent-primary-600"
              />
              <p className="text-[10px] text-ink-400 text-center">Minimo €{minPrice}</p>
            </div>
            <div>
              <input
                type="range"
                min={5}
                max={500}
                step={5}
                value={maxPrice}
                onChange={(e) => setMaxPrice(Math.max(Number(e.target.value), minPrice + 5))}
                className="w-full accent-primary-600"
              />
              <p className="text-[10px] text-ink-400 text-center">Massimo €{maxPrice}{maxPrice >= 500 ? '+' : ''}</p>
            </div>
          </div>
        </div>

        {/* Rating minimo */}
        <div>
          <label className="block text-xs font-semibold text-ink-700 mb-2 uppercase tracking-wider flex items-center gap-1">
            <Star size={11} strokeWidth={2.2} />
            Rating minimo
          </label>
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
                {r === 0 ? 'Tutti' : `${r}+`}
              </button>
            ))}
          </div>
        </div>

        {/* Checkbox */}
        <div className="space-y-2 border-t border-cream-200 pt-4">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={freeShipping}
              onChange={(e) => setFreeShipping(e.target.checked)}
              className="accent-primary-600"
            />
            <Truck size={14} strokeWidth={2.2} className="text-olive-600" />
            <span>Spedizione gratuita (≥ €30)</span>
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={onlyOpenStores}
              onChange={(e) => setOnlyOpenStores(e.target.checked)}
              className="accent-primary-600"
            />
            <CircleDot size={14} strokeWidth={2.2} className="text-olive-600" />
            <span>Solo negozi aperti ora</span>
          </label>
        </div>
      </aside>

      <main className="md:col-span-3">
        <div className="flex items-end justify-between mb-6 gap-4 flex-wrap">
          <h1 className="text-2xl md:text-3xl font-serif font-bold text-ink-900">
            {q ? <>Risultati per &laquo;<span className="text-primary-700">{q}</span>&raquo;</> : 'Tutti i prodotti'}
          </h1>
          {sort !== 'relevance' && (
            <span className="text-sm text-ink-500 inline-flex items-center gap-1">
              {sort === 'price_asc' || sort === 'price_desc' ? <ArrowDownAZ size={14} /> : <TrendingUp size={14} />}
              Ordinato per {sort === 'newest' ? 'più recenti' : sort === 'price_asc' ? 'prezzo crescente' : sort === 'price_desc' ? 'prezzo decrescente' : 'più recensiti'}
            </span>
          )}
        </div>
        <ProductGrid
          search={q || undefined}
          categoryId={categoryId || undefined}
          maxPrice={maxPrice < 500 ? maxPrice : undefined}
          minPrice={minPrice > 0 ? minPrice : (freeShipping ? 30 : undefined)}
          onlyOpenStores={onlyOpenStores}
          minRating={minRating > 0 ? minRating : undefined}
          sort={sort}
        />
      </main>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="container mx-auto p-8 text-center text-ink-500">Caricamento…</div>}>
      <SearchInner />
    </Suspense>
  );
}
