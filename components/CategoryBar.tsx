'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
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

/**
 * Category bar dentro al primary navbar (terracotta).
 * Sempre visibile (no auto-hide su scroll) per non disorientare.
 * Highlight della categoria attiva basato su pathname.
 */
const CategoryBar = () => {
  const pathname = usePathname() ?? '';
  const { data: categories = [] } = useQuery({
    queryKey: ['top-categories'],
    queryFn: fetchTopCategories,
  });

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  return (
    <div className="relative">
      <div className="container mx-auto px-3 sm:px-4 flex items-center gap-1 overflow-x-auto scrollbar-hide py-2 text-sm">
        <Link
          href="/stores"
          className={`flex items-center gap-1.5 whitespace-nowrap font-semibold px-3 py-1.5 rounded-full shrink-0 transition-colors ${
            isActive('/stores')
              ? 'bg-accent-500 text-ink-900'
              : 'text-white hover:bg-white/15'
          }`}
        >
          <Store size={14} strokeWidth={2.2} />
          Tutti i negozi
        </Link>
        <span aria-hidden className="w-px h-5 bg-white/20 mx-1 shrink-0" />
        {categories.map((c) => {
          const href = `/category/${c.slug}`;
          const active = isActive(href);
          return (
            <Link
              key={c.id}
              href={href}
              className={`whitespace-nowrap px-3 py-1.5 rounded-full shrink-0 transition-colors font-medium ${
                active
                  ? 'bg-accent-500 text-ink-900'
                  : 'text-white/90 hover:text-white hover:bg-white/15'
              }`}
            >
              {c.icon && <span className="mr-1">{c.icon}</span>}
              {c.name}
            </Link>
          );
        })}
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute top-0 right-0 h-full w-8 bg-gradient-to-l from-primary-700 to-transparent sm:hidden"
      />
    </div>
  );
};

export default CategoryBar;
