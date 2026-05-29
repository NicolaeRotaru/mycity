'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Store, Percent, Sparkles, LayoutGrid, type LucideIcon } from 'lucide-react';

/**
 * Category bar dentro al primary navbar (terracotta).
 * Voci essenziali e uniformi: Tutti i negozi · Promozioni · Novità · Categorie.
 * L'elenco completo delle categorie vive ora nella pagina /categorie.
 */
type Entry = { href: string; icon: LucideIcon; label: string };

const ENTRIES: Entry[] = [
  { href: '/stores',     icon: Store,      label: 'Tutti i negozi' },
  { href: '/promozioni', icon: Percent,    label: 'Promozioni' },
  { href: '/novita',     icon: Sparkles,   label: 'Novità' },
  { href: '/categorie',  icon: LayoutGrid, label: 'Categorie' },
];

const CategoryBar = () => {
  const pathname = usePathname() ?? '';
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  return (
    <div className="container mx-auto px-3 sm:px-4 flex items-center gap-1.5 overflow-x-auto scrollbar-hide py-2 text-sm">
      {ENTRIES.map((e) => {
        const Icon = e.icon;
        const active = isActive(e.href);
        return (
          <Link
            key={e.href}
            href={e.href}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap font-semibold px-3 py-1.5 rounded-full shrink-0 transition-colors ${
              active
                ? 'bg-accent-500 text-ink-900 shadow-sm'
                : 'text-white/90 hover:text-white hover:bg-white/15'
            }`}
          >
            <Icon size={14} strokeWidth={2.2} />
            {e.label}
          </Link>
        );
      })}
    </div>
  );
};

export default CategoryBar;
