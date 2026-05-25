'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Bell, MessageCircle, ShoppingCart, Package, Bike, Shield, Menu as MenuIcon,
  Search, LogOut, Store, Truck, Banknote, MapPin, Zap,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useProfile } from './hooks/useProfile';
import { useCartCount } from './hooks/useCartCount';
import { useNotificationsCount } from './hooks/useNotificationsCount';
import { useMessagesUnread } from './hooks/useMessagesUnread';
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
  { href: '/messages',          label: 'Messaggi',            icon: '💬' },
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
    { type: 'separator',               label: 'Operatività' },
    { href: '/seller/dashboard',       label: 'Dashboard',         icon: '📊' },
    { href: '/seller/orders',          label: 'Ordini ricevuti',   icon: '🛒' },
    { href: '/seller/products',        label: 'I miei prodotti',   icon: '📦' },
    { href: '/seller/products/new',    label: 'Nuovo prodotto',    icon: '➕' },
    { type: 'separator',               label: 'Business' },
    { href: '/seller/earnings',        label: 'Guadagni',          icon: '💶' },
    { href: '/seller/reviews',         label: 'Recensioni',        icon: '⭐' },
    { href: '/seller/customers',       label: 'I miei clienti',    icon: '👥' },
    { type: 'separator',               label: 'Account' },
    { href: '/seller/profile',         label: 'Profilo negozio',   icon: '🏪' },
    { href: '/profile/settings',       label: 'Impostazioni',      icon: '⚙️' },
    { href: '/messages',               label: 'Messaggi clienti',  icon: '💬' },
    { href: '/notifications',          label: 'Notifiche',         icon: '🔔' },
    { type: 'separator',               label: 'Aiuto' },
    { href: '/seller/help',            label: 'Centro venditori',  icon: '💡' },
    { href: '/faq',                    label: 'FAQ',               icon: '❓' },
    { href: '/contact',                label: 'Contattaci',        icon: '✉️' },
    { type: 'separator',               label: 'Come acquirente' },
    { href: '/?as=buyer',              label: 'Home marketplace',  icon: '🏠' },
    { href: '/stores',                 label: 'Tutti i negozi',    icon: '🏪' },
    { href: '/favorites',              label: 'Preferiti',         icon: '♥' },
    { href: '/orders',                 label: 'I miei ordini',     icon: '📦' },
    { href: '/cart',                   label: 'Carrello',          icon: '🛒' },
    { href: '/profile/referral',       label: 'Invita amici · €5', icon: '🎁' },
  ],
  rider: [
    { type: 'separator',         label: 'Operatività' },
    { href: '/rider',            label: 'Dashboard',         icon: '🛵' },
    { href: '/rider/availability', label: 'Disponibilità',   icon: '🟢' },
    { href: '/rider/history',    label: 'Storico consegne',  icon: '📜' },
    { type: 'separator',         label: 'Business' },
    { href: '/rider/earnings',   label: 'Guadagni',          icon: '💶' },
    { href: '/rider/reviews',    label: 'Recensioni',        icon: '⭐' },
    { type: 'separator',         label: 'Account' },
    { href: '/rider/profile',    label: 'Profilo',           icon: '👤' },
    { href: '/profile/settings', label: 'Impostazioni',      icon: '⚙️' },
    { href: '/notifications',    label: 'Notifiche',         icon: '🔔' },
    { type: 'separator',         label: 'Aiuto' },
    { href: '/rider/help',       label: 'Centro rider',      icon: '💡' },
    { href: '/faq',              label: 'FAQ',               icon: '❓' },
    { href: '/contact',          label: 'Contattaci',        icon: '✉️' },
    { type: 'separator',         label: 'Come acquirente' },
    { href: '/?as=buyer',              label: 'Home marketplace',  icon: '🏠' },
    { href: '/stores',                 label: 'Tutti i negozi',    icon: '🏪' },
    { href: '/favorites',              label: 'Preferiti',         icon: '♥' },
    { href: '/orders',                 label: 'I miei ordini',     icon: '📦' },
    { href: '/cart',                   label: 'Carrello',          icon: '🛒' },
    { href: '/profile/referral',       label: 'Invita amici · €5', icon: '🎁' },
  ],
  admin: [
    { href: '/admin',          label: 'Dashboard admin', icon: '🛡️' },
    { href: '/admin/users',    label: 'Utenti',          icon: '👥' },
    { href: '/admin/orders',   label: 'Tutti gli ordini', icon: '📦' },
    { href: '/admin/products', label: 'Tutti i prodotti', icon: '🛍️' },
    { href: '/admin/coupons',  label: 'Coupon',          icon: '🎟️' },
    { href: '/notifications',  label: 'Notifiche',       icon: '🔔' },
    { type: 'separator',       label: 'Come acquirente' },
    { href: '/?as=buyer',              label: 'Home marketplace',  icon: '🏠' },
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
        className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 text-white px-3 py-2 rounded-lg font-semibold whitespace-nowrap"
      >
        <MenuIcon size={18} strokeWidth={2.2} />
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
                    <LogOut size={16} strokeWidth={2} />
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
        className="bg-indigo-600 hover:bg-indigo-700 px-4 rounded-r-md font-semibold shrink-0 flex items-center justify-center text-white"
        aria-label="Cerca"
      >
        <Search size={18} strokeWidth={2.2} />
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
  const msgUnread = useMessagesUnread();
  const { profile, userEmail, isAuthenticated, isLoading, isSeller, isRider, isAdmin } = useProfile();
  // IMPORTANTE: useScrollHide DEVE essere chiamato qui, prima di qualsiasi
  // early-return. Le Rules of Hooks impongono che la sequenza di chiamate
  // sia identica a ogni render.
  const hideCategoryOnScroll = useScrollHide();

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

  // CategoryBar: mostrata solo a buyer/guest, nascosta in aree pro e durante
  // navigazione in aree pro anche se l'utente è buyer.
  const isProRole = isAdmin || isSeller || isRider;
  const isProArea =
    !!pathname?.startsWith('/seller') ||
    !!pathname?.startsWith('/rider')  ||
    !!pathname?.startsWith('/admin');
  const showCategoryBar = !isProRole && !isProArea;

  const ProfileIcon = ({ compact = false }: { compact?: boolean }) => {
    if (!isAuthenticated) {
      return (
        <div className="flex items-center gap-3 text-sm">
          <Link href="/sign-in" className="hover:text-indigo-300">Accedi</Link>
          <Link href="/sign-up" className="hover:text-indigo-300 hidden sm:inline">Registrati</Link>
        </div>
      );
    }
    const initial = displayName?.[0]?.toUpperCase() ?? '?';
    return (
      <Link
        href={profileHref}
        title="Il tuo account"
        className="flex items-center gap-2 hover:text-indigo-300 transition-colors"
      >
        <span
          className={`${
            isSeller ? 'bg-pink-500/15 ring-pink-400/30 text-pink-300' :
            isRider  ? 'bg-amber-500/15 ring-amber-400/30 text-amber-300' :
                        'bg-indigo-500/15 ring-indigo-400/30 text-indigo-300'
          } w-9 h-9 rounded-full ring-1 flex items-center justify-center text-sm font-bold uppercase shrink-0`}
        >
          {isSeller ? <Store size={16} strokeWidth={2.2} /> : isRider ? <Bike size={16} strokeWidth={2.2} /> : initial}
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
        <Shield size={18} strokeWidth={2} />
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
        <Bell size={20} strokeWidth={2} />
        {notifCount > 0 && (
          <span className="absolute -top-1.5 -right-2 bg-rose-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center">
            {notifCount > 99 ? '99+' : notifCount}
          </span>
        )}
      </Link>
    ) : null;

  const MessagesIcon = () =>
    isAuthenticated ? (
      <Link
        href="/messages"
        title="Messaggi"
        className="relative flex items-center hover:text-indigo-300 transition-colors"
      >
        <MessageCircle size={20} strokeWidth={2} />
        {msgUnread > 0 && (
          <span className="absolute -top-1.5 -right-2 bg-rose-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center">
            {msgUnread > 99 ? '99+' : msgUnread}
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
        {isRider ? <Bike size={20} strokeWidth={2} /> : <Package size={20} strokeWidth={2} />}
        <span className="hidden md:inline">{isRider ? 'Consegne' : 'Ordini'}</span>
      </Link>
    ) : null;

  const CartIcon = () =>
    !isSeller && !isRider ? (
      <Link
        href="/cart"
        title="Carrello"
        className="relative flex items-center gap-1.5 hover:text-indigo-300 transition-colors text-sm"
      >
        <ShoppingCart size={20} strokeWidth={2} />
        {cartCount > 0 && (
          <span className="absolute -top-2 -right-3 bg-rose-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center">
            {cartCount}
          </span>
        )}
        <span className="hidden md:inline">Carrello</span>
      </Link>
    ) : null;

  return (
    <header className="sticky top-0 z-50 shadow-sm">
      <div className="bg-gray-950 text-gray-200 text-xs sm:text-sm border-b border-gray-800">
        <div className="container mx-auto px-4 py-2 flex items-center justify-start sm:justify-center gap-6 overflow-x-auto scrollbar-hide whitespace-nowrap">
          <span className="flex items-center gap-1.5 shrink-0">
            <Truck size={14} strokeWidth={2} className="text-indigo-400" />
            <span className="font-medium">Spedizione gratuita sopra €30</span>
          </span>
          <span className="flex items-center gap-1.5 shrink-0">
            <Banknote size={14} strokeWidth={2} className="text-indigo-400" />
            <span className="font-medium">Pagamento alla consegna</span>
          </span>
          <span className="flex items-center gap-1.5 shrink-0">
            <MapPin size={14} strokeWidth={2} className="text-indigo-400" />
            <span className="font-medium">Venditori 100% locali</span>
          </span>
          <span className="flex items-center gap-1.5 shrink-0">
            <Zap size={14} strokeWidth={2} className="text-indigo-400" />
            <span className="font-medium">Consegna in 24-48h</span>
          </span>
        </div>
      </div>
      <div className="bg-gray-900 text-white">
        {/* MOBILE */}
        <div className="md:hidden">
          <div className="container mx-auto px-4 py-3 flex items-center justify-between gap-3">
            <Link href="/" className="text-xl font-bold tracking-tight whitespace-nowrap">
              <span className="text-indigo-400">My</span>City
            </Link>
            <div className="flex items-center gap-4">
              {!isLoading && <ProfileIcon compact />}
              <MessagesIcon />
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
            <Link href="/" className="text-2xl font-bold tracking-tight whitespace-nowrap">
              <span className="text-indigo-400">My</span>City
            </Link>
            <NavMenu role={role} isAuthenticated={isAuthenticated} onSignOut={handleSignOut} />
            <SearchForm className="flex-1 max-w-2xl" onSubmit={handleSearch} q={q} setQ={setQ} />
            <nav className="ml-auto flex items-center gap-5 text-sm">
              {!isLoading && <ProfileIcon />}
              <AdminLink />
              <MessagesIcon />
              <NotificationsIcon />
              <OrdersIcon />
              <CartIcon />
            </nav>
          </div>
        </div>
      </div>

      {/* CategoryBar: solo per buyer/guest, e con auto-hide su scroll giù */}
      <CategoryBarSlot show={showCategoryBar} hidden={hideCategoryOnScroll} />
    </header>
  );
};

/**
 * Wrapper che applica l'animazione "scrollo giù → si chiude / scrollo su → si apre"
 * usando max-height. Tieni la mount/unmount controllata dal parent così evitiamo
 * effetti sulle aree dove la barra non serve mai (seller/rider/admin).
 */
const CategoryBarSlot = ({ show, hidden }: { show: boolean; hidden: boolean }) => {
  if (!show) return null;
  return (
    <div
      aria-hidden={hidden}
      className={`overflow-hidden transition-[max-height,opacity] duration-300 ease-out ${
        hidden ? 'max-h-0 opacity-0 pointer-events-none' : 'max-h-24 opacity-100'
      }`}
    >
      <CategoryBar />
    </div>
  );
};

/**
 * Restituisce true quando l'utente sta scrollando verso il basso oltre una
 * soglia minima. Throttle via requestAnimationFrame.
 *
 * Anti-tremolio:
 *  - ignora variazioni < 15px (overscroll, momentum, jitter touch)
 *  - cooldown di 400ms tra un toggle e il successivo, più lungo della
 *    transizione CSS (300ms): impedisce che il layout-shift causato dal
 *    cambio di altezza della barra triggeri immediatamente l'evento
 *    opposto creando il loop hide→show→hide
 *  - ignora overscroll negativo (scrollY < 0 sui mobile con bounce)
 */
function useScrollHide(threshold = 80) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let lastY = Math.max(0, typeof window !== 'undefined' ? window.scrollY : 0);
    let ticking = false;
    let lastToggleAt = 0;
    const COOLDOWN_MS = 400;
    const JITTER_PX = 15;

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        const y = Math.max(0, window.scrollY);
        const dy = y - lastY;

        if (Math.abs(dy) < JITTER_PX) { ticking = false; return; }

        const now = Date.now();
        if (now - lastToggleAt < COOLDOWN_MS) {
          // siamo ancora "freschi" da un toggle: aggiorna solo il riferimento
          lastY = y;
          ticking = false;
          return;
        }

        if (dy > 0 && y > threshold) {
          setHidden((cur) => {
            if (!cur) lastToggleAt = now;
            return true;
          });
        } else if (dy < 0) {
          setHidden((cur) => {
            if (cur) lastToggleAt = now;
            return false;
          });
        }
        lastY = y;
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);
  return hidden;
}

export default Navbar;
