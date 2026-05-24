'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Store } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';

type Category = { id: string; slug: string; name: string; icon: string | null };

const fetchTopCategories = async (): Promise<Category[]> => {
  const { data, error } = await supabase
    .from('categories')
    .select('id, slug, name, icon')
    .is('parent_id', null)
    .order('name');
  if (error) throw error;
  return data ?? [];
};

const CategoryBar = () => {
  const { data: categories = [] } = useQuery({
    queryKey: ['top-categories'],
    queryFn: fetchTopCategories,
  });

  return (
    <div className="bg-white border-b border-gray-200 relative">
      <div className="container mx-auto px-4 flex items-center gap-1 overflow-x-auto scrollbar-hide py-2 text-sm">
        <Link
          href="/stores"
          className="flex items-center gap-1.5 text-gray-900 hover:text-indigo-600 whitespace-nowrap font-semibold px-3 py-1.5 rounded-md hover:bg-indigo-50 shrink-0 transition-colors"
        >
          <Store size={16} strokeWidth={2} />
          Tutti i negozi
        </Link>
        <span aria-hidden className="w-px h-5 bg-gray-200 mx-1 shrink-0" />
        {categories.map((c) => (
          <Link
            key={c.id}
            href={`/category/${c.slug}`}
            className="text-gray-600 hover:text-indigo-700 hover:bg-gray-50 whitespace-nowrap px-3 py-1.5 rounded-md shrink-0 transition-colors font-medium"
          >
            {/* Le icone delle categorie sono editabili da admin per categoria,
                quindi le lasciamo come emoji — sono "contenuto", non UI chrome */}
            {c.icon && <span className="mr-1">{c.icon}</span>}
            {c.name}
          </Link>
        ))}
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute top-0 right-0 h-full w-8 bg-gradient-to-l from-white to-transparent sm:hidden"
      />
    </div>
  );
};

export default CategoryBar;
