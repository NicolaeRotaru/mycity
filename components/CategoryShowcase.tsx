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

/**
 * Tessere illustrate: ogni categoria è una tessera "fotografica" col nome in
 * overlay. Finché non ci sono foto reali per categoria si usa un gradiente
 * proprio (dentro la palette Mediterranean) come sfondo — il giorno in cui
 * avrai un'immagine basterà metterla come background per l'effetto pieno.
 * Classi scritte per esteso così Tailwind non le elimina in purge.
 */
const GRAD_MAP: Record<string, string> = {
  alimentari:     'from-olive-500 to-olive-700',
  abbigliamento:  'from-primary-400 to-primary-700',
  bellezza:       'from-secondary-400 to-secondary-700',
  'casa-cucina':  'from-accent-400 to-accent-600',
  casa:           'from-accent-400 to-accent-600',
  cucina:         'from-accent-400 to-accent-600',
  elettronica:    'from-ink-600 to-ink-900',
  giardino:       'from-olive-400 to-olive-600',
  giocattoli:     'from-secondary-400 to-secondary-600',
  libri:          'from-primary-400 to-primary-600',
  sport:          'from-olive-500 to-olive-700',
};

function iconFor(slug: string): LucideIcon {
  return ICON_MAP[slug] ?? Tag;
}

function gradFor(slug: string): string {
  return GRAD_MAP[slug] ?? 'from-primary-500 to-primary-700';
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
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {categories.slice(0, 6).map((c) => {
        const Icon = iconFor(c.slug);
        const grad = gradFor(c.slug);
        return (
          <Link
            key={c.id}
            href={`/category/${c.slug}`}
            className="group relative flex aspect-[4/3] items-end overflow-hidden rounded-2xl shadow-card transition-transform hover:-translate-y-0.5"
          >
            {/* Sfondo "foto" (gradiente proprio della categoria) */}
            <div className={`absolute inset-0 bg-gradient-to-br ${grad} transition-transform duration-300 group-hover:scale-105`} />
            {/* Scrim per leggibilità del testo */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/10 to-black/20" />
            <span className="absolute left-2.5 top-2.5 text-white/90">
              <Icon size={18} strokeWidth={2.2} />
            </span>
            <span className="relative p-3 text-sm font-bold leading-tight text-white drop-shadow">{c.name}</span>
          </Link>
        );
      })}
    </div>
  );
};

export default CategoryShowcase;
