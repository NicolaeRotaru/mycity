'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Menu, Store, Search, ChevronDown } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { queryKeys } from '@/lib/queries/keys';

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

interface Props {
  className?: string;
}

/**
 * Menu a tendina stile Amazon/eBay: bottone "Tutte le categorie" che apre un
 * pannello con la lista delle categorie. Click fuori o ESC per chiudere.
 */
const CategoriesDropdown = ({ className = '' }: Props) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const { data: categories = [] } = useQuery({
    queryKey: queryKeys.categories.top,
    queryFn: fetchTopCategories,
  });

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 bg-ink-800 hover:bg-gray-700 text-white px-3 py-2 rounded-md text-sm font-semibold whitespace-nowrap border border-gray-700"
      >
        <Menu size={18} strokeWidth={2.2} aria-hidden />
        <span>Categorie</span>
        <ChevronDown size={14} strokeWidth={2.2} aria-hidden className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full mt-1 w-64 bg-white text-ink-800 rounded-lg shadow-2xl border border-cream-300 overflow-hidden z-50"
        >
          <Link
            href="/stores"
            onClick={() => setOpen(false)}
            className="flex items-center gap-3 px-4 py-2.5 hover:bg-primary-50 border-b border-cream-200 font-semibold"
            role="menuitem"
          >
            <Store size={20} strokeWidth={2.2} className="text-primary-600" aria-hidden />
            <span>Tutti i negozi</span>
          </Link>
          <Link
            href="/search"
            onClick={() => setOpen(false)}
            className="flex items-center gap-3 px-4 py-2.5 hover:bg-primary-50 border-b border-cream-200 font-semibold"
            role="menuitem"
          >
            <Search size={20} strokeWidth={2.2} className="text-primary-600" aria-hidden />
            <span>Tutti i prodotti</span>
          </Link>
          {categories.map((c) => (
            <Link
              key={c.id}
              href={`/category/${c.slug}`}
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-2.5 hover:bg-primary-50"
              role="menuitem"
            >
              <span className="text-xl">{c.icon}</span>
              <span>{c.name}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
};

export default CategoriesDropdown;
