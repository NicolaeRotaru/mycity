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
    <div className="bg-gray-800 border-t border-gray-700">
      <div className="container mx-auto px-4 flex items-center gap-4 overflow-x-auto scrollbar-hide py-2 text-sm">
        <Link href="/stores" className="text-white hover:text-indigo-300 whitespace-nowrap font-semibold">
          🏪 Tutti i negozi
        </Link>
        {categories.map((c) => (
          <Link
            key={c.id}
            href={`/category/${c.slug}`}
            className="text-gray-200 hover:text-white whitespace-nowrap"
          >
            {c.icon} {c.name}
          </Link>
        ))}
      </div>
    </div>
  );
};

export default CategoryBar;
