'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import ProductGrid from '@/components/ProductGrid';
import { LoadingState } from '@/components/ui/LoadingState';
import { queryKeys } from '@/lib/queries/keys';

export default function CategoryPage({ params }: { params: { slug: string } }) {
  const { slug } = params;

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

  const { data: subcategories = [] } = useQuery({
    queryKey: [...queryKeys.categories.all, 'sub', category?.id],
    queryFn: async () => {
      if (!category) return [];
      const { data, error } = await supabase
        .from('categories')
        .select('id, slug, name, icon')
        .eq('parent_id', category.id)
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!category,
  });

  if (isLoading) return <LoadingState />;
  if (!category) return <div className="container mx-auto p-8 text-center">Categoria non trovata.</div>;

  return (
    <div className="container mx-auto px-6 py-8 space-y-8">
      <header className="flex items-center gap-4">
        <span className="text-5xl">{category.icon}</span>
        <div>
          <h1 className="text-3xl font-bold">{category.name}</h1>
          <p className="text-ink-500">Esplora i prodotti della categoria</p>
        </div>
      </header>

      {subcategories.length > 0 && (
        <section>
          <h2 className="text-xl font-bold mb-3">Sottocategorie</h2>
          <div className="flex flex-wrap gap-3">
            {subcategories.map((s: any) => (
              <Link
                key={s.id}
                href={`/category/${s.slug}`}
                className="bg-white border rounded-full px-4 py-2 hover:bg-primary-50 hover:border-primary-400 text-sm font-medium"
              >
                {s.name}
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-xl font-bold mb-4">Prodotti</h2>
        <ProductGrid categoryId={category.id} />
      </section>
    </div>
  );
}
