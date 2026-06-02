'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Store, Percent, Sparkles, Gift, MapPin, Flame, PiggyBank, type LucideIcon } from 'lucide-react';
import CategoriesMegaMenu from './CategoriesMegaMenu';

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

/**
 * Barra sotto l'header (terracotta). A sinistra il mega-menu "Tutte le
 * categorie" (asse merceologico); a destra le destinazioni speciali curate,
 * scrollabili in orizzontale su schermi stretti.
 */
const CategoryBar = () => {
  const pathname = usePathname() ?? '';
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  return (
    <div className="container mx-auto flex items-center gap-2 px-3 py-2 text-sm sm:px-4">
      <CategoriesMegaMenu />
      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide">
        {DESTINATIONS.map((e) => {
          const Icon = e.icon;
          const active = isActive(e.href);
          return (
            <Link
              key={e.href}
              href={e.href}
              className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 font-semibold transition-colors ${
                active ? 'bg-accent-500 text-ink-900 shadow-sm' : 'text-white/90 hover:bg-white/15 hover:text-white'
              }`}
            >
              <Icon size={14} strokeWidth={2.2} />
              {e.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
};

export default CategoryBar;
