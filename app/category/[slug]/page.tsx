'use client';;
import { use } from "react";

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import ProductGrid from '@/components/ProductGrid';
import { LoadingState } from '@/components/ui/LoadingState';
import { queryKeys } from '@/lib/queries/keys';

export default function CategoryPage(props: { params: Promise<{ slug: string }> }) {
  const params = use(props.params);
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

  type SubcatRow = { id: string; slug: string; name: string; icon: string | null };
  const { data: subcategories = [] } = useQuery({
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

  if (isLoading) return <LoadingState />;
  if (!category) return <div className="container mx-auto p-8 text-center">Categoria non trovata.</div>;

  // Schema.org BreadcrumbList JSON-LD (Home > Categoria) per rich results Google.
  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: '/' },
      { '@type': 'ListItem', position: 2, name: category.name, item: `/category/${slug}` },
    ],
  };

  return (
    <div className="container mx-auto px-6 py-8 space-y-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
      />
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
            {subcategories.map((s) => (
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
        {category.parent_id === null && subcategories.length > 0 ? (
          <ProductGrid categoryIds={[category.id, ...subcategories.map((s) => s.id)]} />
        ) : (
          <ProductGrid categoryId={category.id} />
        )}
      </section>
    </div>
  );
}
