'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutGrid, ChevronDown, Store, Search,
  Shirt, Apple, Sparkles, Home as HomeIcon, Smartphone, Leaf, Gamepad2, BookOpen, Trophy, Tag,
  type LucideIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';

const ICON_MAP: Record<string, LucideIcon> = {
  abbigliamento: Shirt, alimentari: Apple, bellezza: Sparkles,
  'casa-cucina': HomeIcon, casa: HomeIcon, cucina: HomeIcon,
  elettronica: Smartphone, giardino: Leaf, giocattoli: Gamepad2,
  libri: BookOpen, sport: Trophy,
};
const iconFor = (slug: string): LucideIcon => ICON_MAP[slug] ?? Tag;

type Cat = { id: string; slug: string; name: string; parent_id: string | null; icon: string | null };

/**
 * Mega-menu "Tutte le categorie": pannello ricco con le categorie principali e
 * le relative sottocategorie (stile Amazon/eBay), nel tema Mediterranean Modern.
 * Click fuori o ESC per chiudere. Se una categoria non ha sottocategorie mostra
 * solo "Vedi tutto" (niente colonne vuote).
 */
export default function CategoriesMegaMenu() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const { data: cats = [] } = useQuery({
    queryKey: ['categories', 'tree'],
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<Cat[]> => {
      const { data, error } = await supabase
        .from('categories')
        .select('id, slug, name, parent_id, icon')
        .order('name');
      if (error) throw error;
      return (data ?? []) as Cat[];
    },
  });

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const tops = cats.filter((c) => c.parent_id === null);
  const childrenOf = (id: string) => cats.filter((c) => c.parent_id === id);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-white/15 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-white/25"
      >
        <LayoutGrid size={15} strokeWidth={2.2} />
        Tutte le categorie
        <ChevronDown size={13} strokeWidth={2.6} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-2 w-[min(900px,92vw)] rounded-2xl bg-white p-5 text-ink-800 shadow-warm-lg ring-1 ring-cream-300"
        >
          <div className="mb-4 flex flex-wrap gap-2 border-b border-cream-200 pb-4">
            <Link href="/stores" onClick={() => setOpen(false)} className="inline-flex items-center gap-2 rounded-full bg-primary-50 px-3 py-1.5 text-sm font-semibold text-primary-700 hover:bg-primary-100">
              <Store size={15} strokeWidth={2.2} /> Tutti i negozi
            </Link>
            <Link href="/search" onClick={() => setOpen(false)} className="inline-flex items-center gap-2 rounded-full bg-cream-100 px-3 py-1.5 text-sm font-semibold text-ink-700 hover:bg-cream-200">
              <Search size={15} strokeWidth={2.2} /> Tutti i prodotti
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
            {tops.map((top) => {
              const Icon = iconFor(top.slug);
              const kids = childrenOf(top.id);
              return (
                <div key={top.id}>
                  <Link
                    href={`/category/${top.slug}`}
                    onClick={() => setOpen(false)}
                    className="mb-2 flex items-center gap-2 font-bold text-ink-900 hover:text-primary-700"
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-100 text-primary-700">
                      <Icon size={15} strokeWidth={2.2} />
                    </span>
                    {top.name}
                  </Link>
                  <ul className="space-y-1.5 pl-1">
                    {kids.length > 0 ? (
                      kids.slice(0, 6).map((ch) => (
                        <li key={ch.id}>
                          <Link href={`/category/${ch.slug}`} onClick={() => setOpen(false)} className="text-sm text-ink-600 hover:text-primary-700">
                            {ch.name}
                          </Link>
                        </li>
                      ))
                    ) : (
                      <li>
                        <Link href={`/category/${top.slug}`} onClick={() => setOpen(false)} className="text-xs font-semibold text-ink-400 hover:text-primary-700">
                          Vedi tutto →
                        </Link>
                      </li>
                    )}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
