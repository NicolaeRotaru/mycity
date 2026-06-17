'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { LayoutGrid, Tag } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { LoadingState } from '@/components/ui/LoadingState';

type Cat = { id: string; slug: string; name: string; icon: string | null; parent_id: string | null };

/**
 * Indice di tutte le categorie con le relative sottocategorie.
 * Sostituisce l'elenco lungo che prima stava nella CategoryBar.
 */
export default function CategoriePage() {
  const { data: cats = [], isLoading } = useQuery({
    queryKey: ['all-categories-tree'],
    queryFn: async (): Promise<Cat[]> => {
      const { data, error } = await supabase
        .from('categories')
        .select('id, slug, name, icon, parent_id')
        .order('name');
      if (error) throw error;
      return (data ?? []) as Cat[];
    },
  });

  if (isLoading) return <LoadingState />;

  const tops = cats.filter((c) => c.parent_id === null);
  const childrenOf = (id: string) => cats.filter((c) => c.parent_id === id);

  return (
    <div className="container mx-auto px-4 py-8 space-y-6 max-w-5xl">
      <header className="flex items-center gap-4">
        <span className="w-14 h-14 rounded-2xl bg-primary-100 text-primary-700 flex items-center justify-center shrink-0">
          <LayoutGrid size={26} strokeWidth={2.2} />
        </span>
        <div>
          <h1 className="text-3xl font-serif font-bold text-ink-900">Categorie</h1>
          <p className="text-ink-500">Esplora tutte le categorie e le sottocategorie</p>
        </div>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {tops.map((c) => {
          const subs = childrenOf(c.id);
          return (
            <div key={c.id} className="bg-white border border-cream-300 rounded-2xl p-5">
              <Link
                href={`/category/${c.slug}`}
                className="flex items-center gap-2 font-serif font-bold text-lg text-ink-900 hover:text-primary-700"
              >
                <span className="flex items-center text-2xl text-primary-600">{c.icon ?? <Tag size={24} strokeWidth={2.2} aria-hidden />}</span>
                {c.name}
              </Link>
              {subs.length > 0 ? (
                <div className="flex flex-wrap gap-2 mt-3">
                  {subs.map((s) => (
                    <Link
                      key={s.id}
                      href={`/category/${s.slug}`}
                      className="bg-cream-100 hover:bg-primary-50 hover:text-primary-700 text-ink-700 border border-cream-200 rounded-full px-3 py-1 text-sm font-medium"
                    >
                      {s.name}
                    </Link>
                  ))}
                </div>
              ) : (
                <Link href={`/category/${c.slug}`} className="text-sm text-primary-700 hover:underline mt-2 inline-block">
                  Vedi i prodotti →
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
