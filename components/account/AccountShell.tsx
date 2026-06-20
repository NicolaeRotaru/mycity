'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  User, Package, MapPin, Heart, Bell, Sparkles,
  Gift, UserPlus, Settings, Trophy,
  type LucideIcon,
} from 'lucide-react';
import AccountSidebar from '@/components/account/AccountSidebar';

/**
 * Account shell acquirente — layout responsive 2 colonne: aside sticky ~260px
 * (AccountSidebar) + colonna contenuto. Vive SOTTO la global Navbar (è
 * content-level, non un'app dedicata). Su mobile l'aside si comprime in una nav
 * orizzontale scrollabile in cima, sopra il contenuto.
 */

type NavItem = { href: string; icon: LucideIcon; label: string };

// Stesse rotte della sidebar, in forma piatta per la striscia mobile.
const MOBILE_NAV: NavItem[] = [
  { href: '/profile', icon: User, label: 'Profilo' },
  { href: '/orders', icon: Package, label: 'Ordini' },
  { href: '/profile/addresses', icon: MapPin, label: 'Indirizzi' },
  { href: '/favorites', icon: Heart, label: 'Preferiti' },
  { href: '/notifications', icon: Bell, label: 'Notifiche' },
  { href: '/profile/loyalty', icon: Sparkles, label: 'Punti' },
  { href: '/profile/referral', icon: UserPlus, label: 'Inviti' },
  { href: '/profile/gift-cards', icon: Gift, label: 'Gift card' },
  { href: '/profile/achievements', icon: Trophy, label: 'Obiettivi' },
  { href: '/profile/settings', icon: Settings, label: 'Impostazioni' },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/profile') return pathname === '/profile';
  return pathname === href || pathname.startsWith(href + '/');
}

function MobileAccountNav() {
  const pathname = usePathname() ?? '';
  return (
    <nav
      aria-label="Menu account"
      className="-mx-4 mb-4 overflow-x-auto px-4 lg:hidden"
    >
      <ul className="flex w-max gap-2">
        {MOBILE_NAV.map((n) => {
          const on = isActive(pathname, n.href);
          const Icon = n.icon;
          return (
            <li key={n.href}>
              <Link
                href={n.href}
                aria-current={on ? 'page' : undefined}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-2 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ${
                  on
                    ? 'border-primary-200 bg-primary-50 font-bold text-primary-800'
                    : 'border-cream-300 bg-white font-medium text-ink-700 hover:bg-cream-50'
                }`}
              >
                <Icon
                  size={16}
                  strokeWidth={2.2}
                  className={on ? 'text-primary-700' : 'text-ink-500'}
                  aria-hidden
                />
                {n.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export default function AccountShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="container mx-auto px-4 py-6 sm:px-6 sm:py-8">
      <div className="lg:grid lg:grid-cols-[260px_minmax(0,1fr)] lg:items-start lg:gap-7">
        {/* Sidebar desktop */}
        <aside className="hidden lg:block lg:sticky lg:top-24">
          <AccountSidebar />
        </aside>

        {/* Nav orizzontale mobile */}
        <MobileAccountNav />

        {/* Contenuto */}
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
