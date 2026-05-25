'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  Store, Shirt, Apple, Sparkles, Home as HomeIcon, Smartphone,
  Leaf, Gamepad2, BookOpen, Trophy, ChevronRight, Tag,
  type LucideIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';

type Category = { id: string; slug: string; name: string; icon: string | null };

/**
 * Mappa slug categoria → icona Lucide. Override sulle emoji "cartoon" del DB
 * per dare un look più professionale e coerente.
 * Fallback su Tag per categorie non mappate (es. categorie create da admin).
 */
const ICON_MAP: Record<string, LucideIcon> = {
  abbigliamento:  Shirt,
  alimentari:     Apple,
  bellezza:       Sparkles,
  'casa-cucina':  HomeIcon,
  casa:           HomeIcon,
  cucina:         HomeIcon,
  elettronica:    Smartphone,
  giardino:       Leaf,
  giocattoli:     Gamepad2,
  libri:          BookOpen,
  sport:          Trophy,
};

function iconFor(slug: string): LucideIcon {
  return ICON_MAP[slug] ?? Tag;
}

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
 * Sempre visibile, no auto-hide su scroll, no overflow text.
 * Icone Lucide al posto degli emoji (più professionale).
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
      <div className="container mx-auto px-3 sm:px-4 flex items-center gap-1.5 overflow-x-auto scrollbar-hide py-2 text-sm">
        <Link
          href="/stores"
          className={`inline-flex items-center gap-1.5 whitespace-nowrap font-semibold px-3 py-1.5 rounded-full shrink-0 transition-colors ${
            isActive('/stores')
              ? 'bg-accent-500 text-ink-900 shadow-sm'
              : 'text-white hover:bg-white/15'
          }`}
        >
          <Store size={14} strokeWidth={2.2} />
          Tutti i negozi
        </Link>
        <span aria-hidden className="w-px h-5 bg-white/20 mx-0.5 shrink-0" />
        {categories.map((c) => {
          const href = `/category/${c.slug}`;
          const active = isActive(href);
          const Icon = iconFor(c.slug);
          return (
            <Link
              key={c.id}
              href={href}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 rounded-full shrink-0 transition-colors font-medium ${
                active
                  ? 'bg-accent-500 text-ink-900 shadow-sm'
                  : 'text-white/90 hover:text-white hover:bg-white/15'
              }`}
            >
              <Icon size={14} strokeWidth={2.2} />
              {c.name}
            </Link>
          );
        })}
        {/* Spazio finale + chevron per indicare scroll */}
        <span aria-hidden className="w-12 shrink-0 inline-flex items-center justify-center text-white/40">
          <ChevronRight size={14} strokeWidth={2.4} />
        </span>
      </div>
      {/* Fade gradient più ampio per indicare che lo scroll continua */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-0 right-0 h-full w-16 bg-gradient-to-l from-primary-700 via-primary-700/80 to-transparent"
      />
    </div>
  );
};

export default CategoryBar;
