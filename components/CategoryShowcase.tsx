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
    <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2.5 sm:gap-3">
      {categories.slice(0, 9).map((c) => {
        const Icon = iconFor(c.slug);
        return (
          <Link
            key={c.id}
            href={`/category/${c.slug}`}
            className="group flex flex-col items-center gap-2 rounded-2xl border border-cream-300 bg-white p-3 text-center transition-all hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-warm"
          >
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary-100 text-primary-700 transition-colors group-hover:bg-primary-600 group-hover:text-white">
              <Icon size={20} strokeWidth={2} />
            </span>
            <span className="text-xs font-semibold leading-tight text-ink-800 transition-colors group-hover:text-primary-700">{c.name}</span>
          </Link>
        );
      })}
    </div>
  );
};

export default CategoryShowcase;
