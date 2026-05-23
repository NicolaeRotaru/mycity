'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { useProfile } from './hooks/useProfile';
import { useCartCount } from './hooks/useCartCount';
import { useNotificationsCount } from './hooks/useNotificationsCount';
import CategoryBar from './CategoryBar';

type Role = 'buyer' | 'seller' | 'rider' | 'admin' | null;

type NavLink = { href: string; label: string; icon: string };
type NavSeparator = { type: 'separator'; label: string };
type NavItem = NavLink | NavSeparator;

const isSeparator = (item: NavItem): item is NavSeparator =>
  'type' in item && item.type === 'separator';

const BUYER_LINKS: NavItem[] = [
  { href: '/',                  label: 'Home',                icon: '🏠' },
  { href: '/near',              label: 'Vicino a te',         icon: '📍' },
  { href: '/groups',            label: 'Gruppi d\'acquisto',  icon: '🤝' },
  { href: '/stores',            label: 'Tutti i negozi',      icon: '🏪' },
  { href: '/favorites',         label: 'Preferiti',           icon: '♥' },
  { href: '/orders',            label: 'I miei ordini',       icon: '📦' },
  { href: '/cart',              label: 'Carrello',            icon: '🛒' },
  { href: '/profile/addresses', label: 'Indirizzi',           icon: '📌' },
  { href: '/profile/referral',  label: 'Invita amici · €5',   icon: '🎁' },
  { href: '/notifications',     label: 'Notifiche',           icon: '🔔' },
  { href: '/profile',           label: 'Profilo',             icon: '👤' },
  { href: '/profile/settings',  label: 'Impostazioni',        icon: '⚙️' },
  { type: 'separator',          label: 'Informazioni' },
  { href: '/faq',               label: 'FAQ',                 icon: '❓' },
  { href: '/help',              label: 'Centro assistenza',   icon: '💡' },
  { href: '/contact',           label: 'Contattaci',          icon: '✉️' },
];

const LINKS_BY_ROLE: Record<NonNullable<Role>, NavItem[]> = {
  buyer: BUYER_LINKS,
  seller: [
    { href: '/seller',                 label: 'Dashboard',         icon: '📊' },
    { href: '/seller/products',        label: 'I miei prodotti',   icon: '📦' },
    { href: '/seller/products/new',    label: 'Nuovo prodotto',    icon: '➕' },
    { href: '/seller/orders',          label: 'Ordini ricevuti',   icon: '🛒' },
    { href: '/seller/customers',       label: 'I miei clienti',    icon: '👥' },
    { href: '/seller/profile',         label: 'Profilo negozio',   icon: '🏪' },
    { href: '/notifications',          label: 'Notifiche',         icon: '🔔' },
    { href: '/profile/settings',       label: 'Impostazioni',      icon: '⚙️' },
    { type: 'separator',               label: 'Come acquirente' },
    { href: '/',                       label: 'Home marketplace',  icon: '🏠' },
    { href: '/stores',                 label: 'Tutti i negozi',    icon: '🏪' },
    { href: '/favorites',              label: 'Preferiti',         icon: '♥' },
    { href: '/orders',                 label: 'I miei ordini',     icon: '📦' },
    { href: '/cart',                   label: 'Carrello',          icon: '🛒' },
    { href: '/profile/referral',       label: 'Invita amici · €5', icon: '🎁' },
    { type: 'separator',               label: 'Informazioni' },
    { href: '/faq',                    label: 'FAQ',               icon: '❓' },
    { href: '/help',                   label: 'Centro assistenza', icon: '💡' },
    { href: '/contact',                label: 'Contattaci',        icon: '✉️' },
  ],
  rider: [
    { href: '/rider',          label: 'Dashboard',     icon: '🛵' },
    { href: '/rider/history',  label: 'Storico',       icon: '📜' },
    { href: '/rider/profile',  label: 'Profilo',       icon: '👤' },
    { href: '/notifications',  label: 'Notifiche',     icon: '🔔' },
    { href: '/profile/settings', label: 'Impostazioni', icon: '⚙️' },
    { type: 'separator',       label: 'Come acquirente' },
    { href: '/',                       label: 'Home marketplace',  icon: '🏠' },
    { href: '/stores',                 label: 'Tutti i negozi',    icon: '🏪' },
    { href: '/favorites',              label: 'Preferiti',         icon: '♥' },
    { href: '/orders',                 label: 'I miei ordini',     icon: '📦' },
    { href: '/cart',                   label: 'Carrello',          icon: '🛒' },
    { href: '/profile/referral',       label: 'Invita amici · €5', icon: '🎁' },
    { type: 'separator',               label: 'Informazioni' },
    { href: '/faq',                    label: 'FAQ',               icon: '❓' },
    { href: '/help',                   label: 'Centro assistenza', icon: '💡' },
    { href: '/contact',                label: 'Contattaci',        icon: '✉️' },
  ],
  admin: [
    { href: '/admin',          label: 'Dashboard admin', icon: '🛡️' },
    { href: '/admin/users',    label: 'Utenti',          icon: '👥' },
    { href: '/admin/orders',   label: 'Tutti gli ordini', icon: '📦' },
    { href: '/admin/products', label: 'Tutti i prodotti', icon: '🛍️' },
    { href: '/admin/coupons',  label: 'Coupon',          icon: '🎟️' },
    { href: '/notifications',  label: 'Notifiche',       icon: '🔔' },
    { type: 'separator',       label: 'Come acquirente' },
    { href: '/',                       label: 'Home marketplace',  icon: '🏠' },
    { href: '/near',                   label: 'Vicino a te',       icon: '📍' },
    { href: '/groups',                 label: 'Gruppi d\'acquisto', icon: '🤝' },
    { href: '/stores',                 label: 'Tutti i negozi',    icon: '🏪' },
    { href: '/favorites',              label: 'Preferiti',         icon: '♥' },
    { href: '/orders',                 label: 'I miei ordini',     icon: '📦' },
    { href: '/cart',                   label: 'Carrello',          icon: '🛒' },
    { href: '/profile/addresses',      label: 'Indirizzi',         icon: '📌' },
    { href: '/profile/referral',       label: 'Invita amici · €5', icon: '🎁' },
    { href: '/profile',                label: 'Profilo',           icon: '👤' },
    { href: '/profile/settings',       label: 'Impostazioni',      icon: '⚙️' },
    { type: 'separator',               label: 'Informazioni' },
    { href: '/faq',                    label: 'FAQ',               icon: '❓' },
    { href: '/help',                   label: 'Centro assistenza', icon: '💡' },
    { href: '/contact',                label: 'Contattaci',        icon: '✉️' },
  ],
};

const LINKS_GUEST: NavItem[] = [
  { href: '/',         label: 'Home',       icon: '🏠' },
  { href: '/near',     label: 'Vicino a te', icon: '📍' },
  { href: '/stores',   label: 'Negozi',     icon: '🏪' },
  { href: '/sign-in',  label: 'Accedi',     icon: '🔑' },
  { href: '/sign-up',  label: 'Registrati', icon: '✨' },
  { type: 'separator', label: 'Informazioni' },
  { href: '/faq',      label: 'FAQ',                 icon: '❓' },
  { href: '/help',     label: 'Centro assistenza',   icon: '💡' },
  { href: '/contact',  label: 'Contattaci',          icon: '✉️' },
];

function getLinks(role: Role, isAuthenticated: boolean): NavItem[] {
  if (!isAuthenticated) return LINKS_GUEST;
  if (role && LINKS_BY_ROLE[role]) return LINKS_BY_ROLE[role];
  return LINKS_BY_ROLE.buyer;
}

const NavMenu = ({ role, isAuthenticated, onSignOut }: {
  role: Role;
  isAuthenticated: boolean;
  onSignOut: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const links = getLinks(role, isAuthenticated);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Menu di navigazione"
        className="flex items-center gap-1 bg-gray-800 hover:bg-gray-700 text-white px-3 py-2 rounded-lg font-semibold whitespace-nowrap"
      >
        <span className="text-lg leading-none">≡</span>
        <span className="text-sm">Menu</span>
      </button>
      {open && (
        <div
          className="absolute left-0 top-full mt-2 w-64 bg-white rounded-xl shadow-xl ring-1 ring-black/5 z-50 overflow-y-auto overscroll-contain pb-[max(env(safe-area-inset-bottom),12px)]"
          style={{
            maxHeight:
              'min(calc(100dvh - 160px - env(safe-area-inset-bottom)), calc(100vh - 220px))',
          }}
        >
          <ul className="py-1">
            {links.map((l, i) => {
              if (isSeparator(l)) {
                return (
                  <li key={`sep-${i}`} className="mt-1 pt-2 border-t border-gray-100">
                    <div className="px-4 py-1 text-[10px] uppercase tracking-widest text-gray-400 font-bold">
                      {l.label}
                    </div>
                  </li>
                );
              }
              return (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-indigo-50 hover:text-indigo-700"
                  >
                    <span className="text-lg">{l.icon}</span>
                    <span className="font-medium">{l.label}</span>
                  </Link>
                </li>
              );
            })}
            {isAuthenticated && (
              <>
                <li><div className="border-t border-gray-100 my-1" /></li>
                <li>
                  <button
                    type="button"
                    onClick={() => { setOpen(false); onSignOut(); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-rose-600 hover:bg-rose-50"
                  >
                    <span className="text-lg">↪</span>
                    <span className="font-medium">Esci</span>
                  </button>
                </li>
              </>
            )}
          </ul>
        </div>
      )}
    </div>
  );
};

// Estratto OUT del Navbar component, altrimenti viene rimontato ad ogni
// re-render → su mobile la tastiera si chiude ad ogni lettera digitata.
const SearchForm = ({ className = '', onSubmit, q, setQ }: {
  className?: string;
  onSubmit: (e: React.FormEvent) => void;
  q: string;
  setQ: (v: string) => void;
}) => (
  <form onSubmit={onSubmit} className={className}>
    <div className="flex">
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Cerca prodotti, negozi..."
        className="w-full min-w-0 px-4 py-2 rounded-l-md text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-400 text-sm sm:text-base"
      />
      <button
        type="submit"
        className="bg-indigo-500 hover:bg-indigo-600 px-4 py-2 rounded-r-md font-semibold shrink-0"
        aria-label="Cerca"
      >
        🔍
      </button>
    </div>
  </form>
);

const Navbar = () => {
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState('');
  const cartCount = useCartCount();
  const notifCount = useNotificationsCount();
  const { profile, userEmail, isAuthenticated, isLoading, isSeller, isRider, isAdmin } = useProfile();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/sign-in');
    router.refresh();
  };

  if (pathname?.startsWith('/sign-in') || pathname?.startsWith('/sign-up')) return null;

  const displayName =
    profile?.full_name?.split(' ')[0] ??
    profile?.store_name ??
    profile?.email?.split('@')[0] ??
    userEmail?.split('@')[0] ??
    '';

  const role: Role = isAdmin ? 'admin' : isSeller ? 'seller' : isRider ? 'rider' : isAuthenticated ? 'buyer' : null;
  const profileHref = isSeller ? '/seller/profile' : isRider ? '/rider/profile' : '/profile';
  const ordersHref  = isSeller ? '/seller/orders'  : isRider ? '/rider'         : '/orders';

  const ProfileIcon = ({ compact = false }: { compact?: boolean }) => {
    if (!isAuthenticated) {
      return (
        <div className="flex items-center gap-3 text-sm">
          <Link href="/sign-in" className="hover:text-indigo-300">Accedi</Link>
          <Link href="/sign-up" className="hover:text-indigo-300 hidden sm:inline">Registrati</Link>
        </div>
      );
    }
    return (
      <Link
        href={profileHref}
        title="Il tuo account"
        className="flex items-center gap-2 hover:text-indigo-300 transition-colors"
      >
        <span
          className={`${
            isSeller ? 'bg-pink-500/20 border-pink-400/40' :
            isRider  ? 'bg-amber-500/20 border-amber-400/40' :
                        'bg-indigo-500/20 border-indigo-400/40'
          } w-9 h-9 rounded-full border flex items-center justify-center text-sm font-bold uppercase shrink-0`}
        >
          {isSeller ? '🏪' : isRider ? '🛵' : (displayName?.[0] ?? '?')}
        </span>
        {!compact && (
          <span className="hidden sm:flex flex-col leading-tight">
            <span className="text-[10px] text-gray-400 uppercase tracking-wide">
              {isSeller ? 'Negozio' : isRider ? 'Rider' : 'Ciao'}
            </span>
            <span className="font-semibold truncate max-w-[120px]">{displayName || 'utente'}</span>
          </span>
        )}
      </Link>
    );
  };

  const AdminLink = () =>
    isAdmin ? (
      <Link href="/admin" title="Admin" className="hidden md:flex items-center gap-1.5 hover:text-rose-300 transition-colors text-sm">
        <span className="text-xl">🛡️</span>
        <span>Admin</span>
      </Link>
    ) : null;

  const NotificationsIcon = () =>
    isAuthenticated ? (
      <Link
        href="/notifications"
        title="Notifiche"
        className="relative flex items-center hover:text-indigo-300 transition-colors"
      >
        <span className="text-xl">🔔</span>
        {notifCount > 0 && (
          <span className="absolute -top-1.5 -right-2 bg-pink-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center">
            {notifCount > 99 ? '99+' : notifCount}
          </span>
        )}
      </Link>
    ) : null;

  const OrdersIcon = () =>
    isAuthenticated ? (
      <Link
        href={ordersHref}
        title={isSeller ? 'Ordini ricevuti' : isRider ? 'Consegne' : 'I tuoi ordini'}
        className="flex items-center gap-1.5 hover:text-indigo-300 transition-colors text-sm"
      >
        <span className="text-xl">{isRider ? '🛵' : '📦'}</span>
        <span className="hidden md:inline">{isRider ? 'Consegne' : 'Ordini'}</span>
      </Link>
    ) : null;

  const CartIcon = () =>
    !isSeller && !isRider ? (
      <Link
        href="/cart"
        title="Carrello"
        className="relative flex items-center gap-1 hover:text-indigo-300 transition-colors text-sm"
      >
        <span className="text-xl">🛒</span>
        {cartCount > 0 && (
          <span className="absolute -top-2 -right-3 bg-pink-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
            {cartCount}
          </span>
        )}
        <span className="hidden md:inline">Carrello</span>
      </Link>
    ) : null;

  return (
    <header className="sticky top-0 z-50 shadow-lg">
      <div className="bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 text-white text-xs sm:text-sm">
        <div className="container mx-auto px-4 py-1.5 flex items-center justify-start sm:justify-center gap-6 overflow-x-auto scrollbar-hide whitespace-nowrap font-medium">
          <span className="shrink-0">🚚 Spedizione GRATUITA sopra €30</span>
          <span className="shrink-0">💰 Pagamento alla consegna</span>
          <span className="shrink-0">🏘️ Venditori 100% locali</span>
          <span className="shrink-0">⚡ Consegna in 24-48h</span>
        </div>
      </div>
      <div className="bg-gray-900 text-white">
        {/* MOBILE */}
        <div className="md:hidden">
          <div className="container mx-auto px-4 py-3 flex items-center justify-between gap-3">
            <Link href="/" className="text-xl font-extrabold whitespace-nowrap">
              <span className="text-indigo-400">My</span>City
            </Link>
            <div className="flex items-center gap-4">
              {!isLoading && <ProfileIcon compact />}
              <NotificationsIcon />
              <OrdersIcon />
              <CartIcon />
            </div>
          </div>
          <div className="container mx-auto px-4 pb-3 flex items-center gap-2">
            <NavMenu role={role} isAuthenticated={isAuthenticated} onSignOut={handleSignOut} />
            <SearchForm className="flex-1 min-w-0" onSubmit={handleSearch} q={q} setQ={setQ} />
          </div>
        </div>

        {/* DESKTOP */}
        <div className="hidden md:block">
          <div className="container mx-auto flex items-center gap-4 px-4 py-3">
            <Link href="/" className="text-2xl font-extrabold whitespace-nowrap">
              <span className="text-indigo-400">My</span>City
            </Link>
            <NavMenu role={role} isAuthenticated={isAuthenticated} onSignOut={handleSignOut} />
            <SearchForm className="flex-1 max-w-2xl" onSubmit={handleSearch} q={q} setQ={setQ} />
            <nav className="ml-auto flex items-center gap-5 text-sm">
              {!isLoading && <ProfileIcon />}
              <AdminLink />
              <NotificationsIcon />
              <OrdersIcon />
              <CartIcon />
            </nav>
          </div>
        </div>
      </div>

      {/* CategoryBar (icone categorie) — nascosta nelle aree riservate */}
      {!pathname?.startsWith('/seller')
        && !pathname?.startsWith('/rider')
        && !pathname?.startsWith('/admin')
        && <CategoryBar />}
    </header>
  );
};

export default Navbar;
