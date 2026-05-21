'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import ProductGrid from '@/components/ProductGrid';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';

function SearchInner() {
  const params = useSearchParams();
  const q = params.get('q') ?? '';
  const [maxPrice, setMaxPrice] = useState<number | ''>('');
  const [categoryId, setCategoryId] = useState<string>('');

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
    <div className="container mx-auto px-6 py-6 grid grid-cols-1 md:grid-cols-4 gap-6">
      <aside className="md:col-span-1 bg-white border rounded-lg p-4 h-fit space-y-4">
        <h2 className="font-bold">Filtri</h2>
        <div>
          <label className="block text-sm font-medium mb-1">Categoria</label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full border p-2 rounded text-sm"
          >
            <option value="">Tutte</option>
            {categories.map((c: any) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Prezzo massimo</label>
          <input
            type="number"
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value ? Number(e.target.value) : '')}
            placeholder="€"
            className="w-full border p-2 rounded text-sm"
          />
        </div>
      </aside>

      <main className="md:col-span-3">
        <h1 className="text-2xl font-bold mb-6">
          {q ? `Risultati per "${q}"` : 'Tutti i prodotti'}
        </h1>
        <ProductGrid
          search={q || undefined}
          categoryId={categoryId || undefined}
          maxPrice={typeof maxPrice === 'number' ? maxPrice : undefined}
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
