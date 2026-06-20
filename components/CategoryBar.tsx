'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  Store, Percent, Sparkles, Gift, MapPin, Flame, PiggyBank,
  LayoutGrid, ChevronDown, Search,
  Shirt, Apple, Home as HomeIcon, Smartphone, Leaf, Gamepad2, BookOpen, Trophy, Tag,
  type LucideIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';

type Entry = { href: string; icon: LucideIcon; label: string };

/**
 * Destinazioni speciali (asse "per intenzione"): lenti curate sul catalogo,
 * NON categorie merceologiche. Quelle merceologiche vivono nel mega-menu.
 */
const DESTINATIONS: Entry[] = [
  { href: '/stores',         icon: Store,     label: 'Tutti i negozi' },
  { href: '/promozioni',     icon: Percent,   label: 'Promozioni' },
  { href: '/novita',         icon: Sparkles,  label: 'Novità' },
  { href: '/regali',         icon: Gift,      label: 'Regali' },
  { href: '/near',           icon: MapPin,    label: 'Vicino a te' },
  { href: '/piu-venduti',    icon: Flame,     label: 'Più venduti' },
  { href: '/piccoli-prezzi', icon: PiggyBank, label: 'Piccoli prezzi' },
];

const ICON_MAP: Record<string, LucideIcon> = {
  abbigliamento: Shirt, alimentari: Apple, bellezza: Sparkles,
  'casa-cucina': HomeIcon, casa: HomeIcon, cucina: HomeIcon,
  elettronica: Smartphone, giardino: Leaf, giocattoli: Gamepad2,
  libri: BookOpen, sport: Trophy,
};
const iconFor = (slug: string): LucideIcon => ICON_MAP[slug] ?? Tag;

type Cat = { id: string; slug: string; name: string; parent_id: string | null; icon: string | null };

/**
 * Barra sotto l'header (terracotta). TUTTE le voci scorrono insieme in
 * orizzontale: il bottone "Tutte le categorie" (mega-menu merceologico) sta
 * nella stessa riga `overflow-x-auto` delle destinazioni speciali. La tendina
 * del mega-menu è invece un fratello della riga, ancorato al root `relative`
 * (che NON ha overflow) così non viene tagliata.
 */
const CategoryBar = () => {
  const pathname = usePathname() ?? '';
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

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
    <div ref={rootRef} className="relative">
      <div className="container mx-auto px-3 sm:px-4">
        {/* Tab underline-style: divider sottile sotto la barra, voce attiva con
            underline + colore accent (per mockup navbar). */}
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide border-b border-white/10 text-sm">
          {/* Mega-menu trigger — stessa riga delle tab, attivo quando aperto */}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-haspopup="menu"
            className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 font-semibold transition-colors ${
              open
                ? 'border-accent-400 text-accent-300'
                : 'border-transparent text-white/90 hover:text-white'
            }`}
          >
            <LayoutGrid size={15} strokeWidth={2.2} />
            Tutte le categorie
            <ChevronDown size={13} strokeWidth={2.6} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>

          {DESTINATIONS.map((e) => {
            const Icon = e.icon;
            const active = isActive(e.href);
            return (
              <Link
                key={e.href}
                href={e.href}
                aria-current={active ? 'page' : undefined}
                className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 transition-colors ${
                  active
                    ? 'border-accent-400 font-semibold text-accent-300'
                    : 'border-transparent font-medium text-white/90 hover:text-white'
                }`}
              >
                <Icon size={14} strokeWidth={2.2} />
                {e.label}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Pannello mega-menu: fratello della riga scrollabile, ancorato al root
          `relative` senza overflow → non viene clippato. */}
      {open && (
        <div className="pointer-events-none absolute left-0 right-0 top-full z-50">
          <div className="container mx-auto px-3 sm:px-4">
            <div
              role="menu"
              className="pointer-events-auto mt-1 w-full max-w-[900px] rounded-2xl bg-white p-5 text-ink-800 shadow-warm-lg ring-1 ring-cream-300"
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
          </div>
        </div>
      )}
    </div>
  );
};

export default CategoryBar;
