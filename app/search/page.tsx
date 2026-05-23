'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import ProductGrid from '@/components/ProductGrid';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';

function SearchInner() {
  const params = useSearchParams();
  const q = params.get('q') ?? '';
  const [maxPrice, setMaxPrice] = useState<number>(200);
  const [categoryId, setCategoryId] = useState<string>('');
  const [onlyOpenStores, setOnlyOpenStores] = useState(false);
  const [freeShipping, setFreeShipping] = useState(false);

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

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 grid grid-cols-1 md:grid-cols-4 gap-6">
      <aside className="md:col-span-1 bg-white border rounded-xl p-5 h-fit space-y-5 md:sticky md:top-32">
        <h2 className="font-bold text-gray-900">Filtri</h2>

        <div>
          <label className="block text-sm font-medium mb-1">Categoria</label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full border p-2 rounded text-sm"
          >
            <option value="">Tutte le categorie</option>
            {categories.map((c: any) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div>
          <div className="flex justify-between text-sm mb-1">
            <label className="font-medium">Prezzo max</label>
            <span className="font-bold text-indigo-700">€{maxPrice}</span>
          </div>
          <input
            type="range"
            min={5}
            max={500}
            step={5}
            value={maxPrice}
            onChange={(e) => setMaxPrice(Number(e.target.value))}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-gray-400">
            <span>€5</span>
            <span>€500</span>
          </div>
        </div>

        <div className="space-y-2 border-t pt-4">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={freeShipping}
              onChange={(e) => setFreeShipping(e.target.checked)}
              className="accent-indigo-600"
            />
            <span>🚚 Spedizione gratuita (≥ €30)</span>
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={onlyOpenStores}
              onChange={(e) => setOnlyOpenStores(e.target.checked)}
              className="accent-indigo-600"
            />
            <span>🟢 Negozi aperti ora</span>
          </label>
        </div>

        <button
          onClick={() => {
            setCategoryId('');
            setMaxPrice(200);
            setOnlyOpenStores(false);
            setFreeShipping(false);
          }}
          className="text-sm text-gray-500 hover:text-indigo-600 underline"
        >
          Reset filtri
        </button>
      </aside>

      <main className="md:col-span-3">
        <h1 className="text-2xl font-bold mb-6 text-gray-900">
          {q ? `Risultati per "${q}"` : 'Tutti i prodotti'}
        </h1>
        <ProductGrid
          search={q || undefined}
          categoryId={categoryId || undefined}
          maxPrice={maxPrice < 500 ? maxPrice : undefined}
          minPrice={freeShipping ? 30 : undefined}
          onlyOpenStores={onlyOpenStores}
        />
      </main>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="container mx-auto p-8 text-center">Caricamento...</div>}>
      <SearchInner />
    </Suspense>
  );
}
