'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';

const CategoryShowcase = () => {
  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('categories')
        .select('id, slug, name, icon')
        .is('parent_id', null)
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-3 gap-3 sm:gap-4">
      {categories.slice(0, 9).map((c: any) => (
        <Link
          key={c.id}
          href={`/category/${c.slug}`}
          className="bg-white border rounded-xl p-4 text-center hover:shadow-md hover:border-indigo-400 transition-all"
        >
          <div className="text-4xl mb-2">{c.icon}</div>
          <p className="text-sm font-semibold text-gray-700">{c.name}</p>
        </Link>
      ))}
    </div>
  );
};

export default CategoryShowcase;
