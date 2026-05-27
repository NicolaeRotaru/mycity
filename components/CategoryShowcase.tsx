'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Shirt, Apple, Sparkles, Home as HomeIcon, Smartphone,
  Leaf, Gamepad2, BookOpen, Trophy, Tag,
  type LucideIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { queryKeys } from '@/lib/queries/keys';

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

type CategoryRow = { id: string; slug: string; name: string; icon: string | null };

const CategoryShowcase = () => {
  const { data: categories = [] } = useQuery({
    queryKey: queryKeys.categories.showcase,
    queryFn: async (): Promise<CategoryRow[]> => {
      const { data, error } = await supabase
        .from('categories')
        .select('id, slug, name, icon')
        .is('parent_id', null)
        .order('name');
      if (error) throw error;
      return (data ?? []) as CategoryRow[];
    },
  });

  return (
    <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-3 gap-3 sm:gap-4">
      {categories.slice(0, 9).map((c) => {
        const Icon = iconFor(c.slug);
        return (
          <Link
            key={c.id}
            href={`/category/${c.slug}`}
            className="bg-white border border-cream-300 rounded-xl p-4 sm:p-5 text-center hover:shadow-warm hover:border-primary-300 hover:-translate-y-0.5 transition-all group"
          >
            <div className="inline-flex w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-primary-100 group-hover:bg-primary-600 group-hover:text-white text-primary-700 items-center justify-center mb-2 transition-colors">
              <Icon size={28} strokeWidth={1.8} />
            </div>
            <p className="text-sm font-semibold text-ink-800 group-hover:text-primary-700 transition-colors">{c.name}</p>
          </Link>
        );
      })}
    </div>
  );
};

export default CategoryShowcase;
