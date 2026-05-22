'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
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
    <div className="bg-gray-800 border-t border-gray-700 relative">
      <div className="container mx-auto px-4 flex items-center gap-5 overflow-x-auto scrollbar-hide py-2.5 text-sm">
        <Link
          href="/stores"
          className="text-white hover:text-indigo-300 whitespace-nowrap font-semibold py-1 shrink-0"
        >
          🏪 Tutti i negozi
        </Link>
        {categories.map((c) => (
          <Link
            key={c.id}
            href={`/category/${c.slug}`}
            className="text-gray-200 hover:text-white whitespace-nowrap py-1 shrink-0"
          >
            {c.icon} {c.name}
          </Link>
        ))}
      </div>
      {/* Sfumatura sul bordo destro: suggerisce che c'è altro contenuto scorribile */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-0 right-0 h-full w-8 bg-gradient-to-l from-gray-800 to-transparent sm:hidden"
      />
    </div>
  );
};

export default CategoryBar;
