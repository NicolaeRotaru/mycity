'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Home, Search, MessageCircle, ShoppingCart, User, Package, Bike, Shield, type LucideIcon } from 'lucide-react';
import { useProfile } from './hooks/useProfile';
import { useCartCount } from './hooks/useCartCount';
import { useMessagesUnread } from './hooks/useMessagesUnread';

type Tab = { href: string; icon: LucideIcon; label: string; badge?: number };

/**
 * Bottom tab bar mobile — feel "app nativa" (Glovo, Deliveroo, Just Eat).
 * 5 tab massimo (best practice mobile UX). Cambia in base al ruolo.
 *
 * Si nasconde su sign-in / sign-up e dentro al thread chat
 * (dove la bottom bar competerebbe con l'input messaggio).
 */
export default function MobileTabBar() {
  const pathname = usePathname() ?? '';
  const { isAuthenticated, isSeller, isRider, isAdmin } = useProfile();
  const cartCount = useCartCount();
  const msgUnread = useMessagesUnread();
  const t = useTranslations('nav');

  // Hide in auth flow + thread chat
  if (
    pathname.startsWith('/sign-in') ||
    pathname.startsWith('/sign-up') ||
    pathname.startsWith('/reset-password') ||
    pathname.startsWith('/auth/') ||
    /^\/messages\/[^/]+/.test(pathname)
  ) return null;

  let tabs: Tab[];

  if (isAdmin) {
    tabs = [
      { href: '/admin',          icon: Shield,        label: t('admin') },
      { href: '/admin/users',    icon: User,          label: t('users') },
      { href: '/admin/orders',   icon: Package,       label: t('orders') },
      { href: '/messages',       icon: MessageCircle, label: t('messages'), badge: msgUnread },
      { href: '/profile',        icon: User,          label: t('me') },
    ];
  } else if (isSeller) {
    tabs = [
      { href: '/seller/dashboard', icon: Home,          label: t('home') },
      { href: '/seller/products',  icon: Package,       label: t('products') },
      { href: '/seller/orders',    icon: ShoppingCart,  label: t('orders') },
      { href: '/messages',         icon: MessageCircle, label: t('messages'), badge: msgUnread },
      { href: '/seller/profile',   icon: User,          label: t('me') },
    ];
  } else if (isRider) {
    tabs = [
      { href: '/rider',              icon: Home,          label: t('home') },
      { href: '/rider/history',      icon: Package,       label: t('history') },
      { href: '/rider/availability', icon: Bike,          label: t('availability') },
      { href: '/messages',           icon: MessageCircle, label: t('messages'), badge: msgUnread },
      { href: '/rider/profile',      icon: User,          label: t('me') },
    ];
  } else if (isAuthenticated) {
    tabs = [
      { href: '/',          icon: Home,          label: t('home') },
      { href: '/search',    icon: Search,        label: t('search') },
      { href: '/cart',      icon: ShoppingCart,  label: t('cart'), badge: cartCount },
      { href: '/messages',  icon: MessageCircle, label: t('messages'), badge: msgUnread },
      { href: '/profile',   icon: User,          label: t('me') },
    ];
  } else {
    tabs = [
      { href: '/',         icon: Home,         label: t('home') },
      { href: '/search',   icon: Search,       label: t('search') },
      { href: '/stores',   icon: Package,      label: t('stores') },
      { href: '/cart',     icon: ShoppingCart, label: t('cart'), badge: cartCount },
      { href: '/sign-in',  icon: User,         label: t('signIn') },
    ];
  }

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/');

  return (
    <nav
      role="navigation"
      aria-label="Navigazione principale"
      className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-ink-100 shadow-warm-lg pb-safe"
    >
      <ul className="flex items-stretch justify-around">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = isActive(t.href);
          return (
            <li key={t.href} className="flex-1">
              <Link
                href={t.href}
                className={`relative flex flex-col items-center justify-center gap-0.5 py-2 transition-colors ${
                  active ? 'text-primary-600' : 'text-ink-500 hover:text-ink-800'
                }`}
              >
                <div className="relative">
                  <Icon size={22} strokeWidth={active ? 2.4 : 2} />
                  {t.badge && t.badge > 0 ? (
                    <span className="absolute -top-1.5 -right-2 bg-primary-600 text-white text-[9px] font-bold rounded-full min-w-[16px] h-[16px] px-1 flex items-center justify-center">
                      {t.badge > 99 ? '99+' : t.badge}
                    </span>
                  ) : null}
                </div>
                <span className={`text-[10px] font-medium tracking-tight ${active ? 'font-semibold' : ''}`}>
                  {t.label}
                </span>
                {active && <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-primary-600 rounded-b" />}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
