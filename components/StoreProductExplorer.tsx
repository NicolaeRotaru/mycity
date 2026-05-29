'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Filter, RotateCcw, Star } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import ProductGrid, { type SortOption } from './ProductGrid';

type Props = { sellerId: string };

type StoreCategory = { id: string; name: string };

/**
 * Ricerca + filtri (set completo) ristretti ai prodotti di un singolo negozio.
 * Usato nella vetrina del negozio. Riusa <ProductGrid> per il rendering e i
 * filtri lato query (search, categoryId, prezzo, rating, ordinamento).
 */
export default function StoreProductExplorer({ sellerId }: Props) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortOption>('relevance');
  const [categoryId, setCategoryId] = useState('');
  const [minPrice, setMinPrice] = useState(0);
  const [maxPrice, setMaxPrice] = useState(500);
  const [minRating, setMinRating] = useState(0);
  const [showFilters, setShowFilters] = useState(false);

  // Categorie effettivamente presenti nei prodotti di questo negozio.
  const { data: categories = [] } = useQuery({
    queryKey: ['store-categories', sellerId],
    queryFn: async (): Promise<StoreCategory[]> => {
      const { data } = await supabase
        .from('products')
        .select('category_id, categories(name)')
        .eq('seller_id', sellerId)
        .eq('status', 'available')
        .not('category_id', 'is', null);
      type Row = { category_id: string | null; categories: { name: string | null } | null };
      const map = new Map<string, string>();
      for (const r of (data ?? []) as unknown as Row[]) {
        if (r.category_id && r.categories?.name) map.set(r.category_id, r.categories.name);
      }
      return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
    },
  });

  const reset = () => {
    setSort('relevance');
    setCategoryId('');
    setMinPrice(0);
    setMaxPrice(500);
    setMinRating(0);
  };

  const activeFilters = [
    categoryId,
    minPrice > 0,
    maxPrice < 500,
    minRating > 0,
    sort !== 'relevance',
  ].filter(Boolean).length;

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" aria-hidden />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cerca nei prodotti del negozio…"
            className="w-full bg-white border border-cream-300 rounded-full pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
          />
        </div>
        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          className="inline-flex items-center gap-1.5 bg-white border border-cream-300 hover:border-primary-300 rounded-full px-4 py-2.5 text-sm font-semibold shrink-0"
          aria-expanded={showFilters}
        >
          <Filter size={16} strokeWidth={2.2} />
          <span className="hidden sm:inline">Filtri</span>
          {activeFilters > 0 && (
            <span className="bg-primary-600 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">
              {activeFilters}
            </span>
          )}
        </button>
      </div>

      {showFilters && (
        <div className="bg-white border border-cream-300 rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
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

          {/* Categoria (solo quelle del negozio) */}
          {categories.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-ink-700 mb-1.5 uppercase tracking-wider">Categoria</label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
              >
                <option value="">Tutte le categorie</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Range prezzo */}
          <div>
            <div className="flex justify-between text-sm mb-2">
              <label className="text-xs font-semibold text-ink-700 uppercase tracking-wider">Prezzo</label>
              <span className="font-bold text-primary-700 text-xs">€{minPrice} - €{maxPrice}{maxPrice >= 500 ? '+' : ''}</span>
            </div>
            <input
              type="range"
              min={0}
              max={500}
              step={5}
              value={minPrice}
              onChange={(e) => setMinPrice(Math.min(Number(e.target.value), maxPrice - 5))}
              className="w-full accent-primary-600"
              aria-label="Prezzo minimo"
            />
            <input
              type="range"
              min={5}
              max={500}
              step={5}
              value={maxPrice}
              onChange={(e) => setMaxPrice(Math.max(Number(e.target.value), minPrice + 5))}
              className="w-full accent-primary-600"
              aria-label="Prezzo massimo"
            />
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
                  type="button"
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

          {activeFilters > 0 && (
            <div className="sm:col-span-2">
              <button onClick={reset} className="text-xs text-ink-500 hover:text-primary-700 inline-flex items-center gap-1">
                <RotateCcw size={12} />
                Azzera filtri
              </button>
            </div>
          )}
        </div>
      )}

      <ProductGrid
        sellerId={sellerId}
        search={search || undefined}
        categoryId={categoryId || undefined}
        minPrice={minPrice > 0 ? minPrice : undefined}
        maxPrice={maxPrice < 500 ? maxPrice : undefined}
        minRating={minRating > 0 ? minRating : undefined}
        sort={sort}
      />
    </div>
  );
}
