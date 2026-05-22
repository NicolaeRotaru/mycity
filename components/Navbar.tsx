'use client';

import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useState } from 'react';
import { useCartCount } from './hooks/useCartCount';
import { useProfile } from './hooks/useProfile';
import { useNotificationsCount } from './hooks/useNotificationsCount';
import CategoryBar from './CategoryBar';
import CategoriesDropdown from './CategoriesDropdown';
import TrustBar from './TrustBar';

const Navbar = () => {
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState('');
  const cartCount = useCartCount();
  const notifCount = useNotificationsCount();
  const { profile, userEmail, isAuthenticated, isLoading, isSeller, isBuyer } = useProfile();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`);
  };

  if (pathname?.startsWith('/sign-in') || pathname?.startsWith('/sign-up')) return null;

  const displayName =
    profile?.full_name?.split(' ')[0] ??
    profile?.store_name ??
    profile?.email?.split('@')[0] ??
    userEmail?.split('@')[0] ??
    '';

  const profileHref = isSeller ? '/seller/profile' : '/profile';
  const ordersHref = isSeller ? '/seller/orders' : '/orders';

  // Avatar + label, riusato in mobile (compatto) e desktop
  const ProfileIcon = ({ compact = false }: { compact?: boolean }) => {
    if (!isAuthenticated) {
      return (
        <div className="flex items-center gap-3 text-sm">
          <Link href="/sign-in" className="hover:text-indigo-300">
            Accedi
          </Link>
          <Link href="/sign-up" className="hover:text-indigo-300 hidden sm:inline">
            Registrati
          </Link>
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
            isSeller
              ? 'bg-pink-500/20 border-pink-400/40'
              : 'bg-indigo-500/20 border-indigo-400/40'
          } w-9 h-9 rounded-full border flex items-center justify-center text-sm font-bold uppercase shrink-0`}
        >
          {isSeller ? '🏪' : (displayName?.[0] ?? '?')}
        </span>
        {!compact && (
          <span className="hidden sm:flex flex-col leading-tight">
            <span className="text-[10px] text-gray-400 uppercase tracking-wide">
              {isSeller ? 'Negozio' : 'Ciao'}
            </span>
            <span className="font-semibold truncate max-w-[120px]">
              {displayName || 'utente'}
            </span>
          </span>
        )}
      </Link>
    );
  };

  const NotificationsIcon = () =>
    isAuthenticated ? (
      <Link
        href="/notifications"
        title="Notifiche"
        className="relative flex items-center hover:text-indigo-300 transition-colors"
        aria-label={`Notifiche${notifCount > 0 ? ` (${notifCount} non lette)` : ''}`}
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
        title={isSeller ? 'Ordini ricevuti' : 'I tuoi ordini'}
        className="flex items-center gap-1.5 hover:text-indigo-300 transition-colors text-sm"
      >
        <span className="text-xl">📦</span>
        <span className="hidden md:inline">Ordini</span>
      </Link>
    ) : null;

  const CartIcon = () =>
    !isSeller ? (
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

  const SearchForm = ({ className = '' }: { className?: string }) => (
    <form onSubmit={handleSearch} className={className}>
      <div className="flex">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Cerca prodotti, negozi..."
          className="w-full px-4 py-2 rounded-l-md text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-400 text-sm sm:text-base"
        />
        <button
          type="submit"
          className="bg-indigo-500 hover:bg-indigo-600 px-4 py-2 rounded-r-md font-semibold"
          aria-label="Cerca"
        >
          🔍
        </button>
      </div>
    </form>
  );

  return (
    <header className="sticky top-0 z-50 shadow-lg">
      <TrustBar />
      <div className="bg-gray-900 text-white">
        {/* ============ MOBILE: due righe ============ */}
        <div className="md:hidden">
          {/* Riga 1: logo + icone */}
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
          {/* Riga 2: dropdown categorie + ricerca */}
          <div className="container mx-auto px-4 pb-3 flex items-center gap-2">
            <CategoriesDropdown />
            <SearchForm className="flex-1" />
          </div>
        </div>

        {/* ============ DESKTOP: singola riga ============ */}
        <div className="hidden md:block">
          <div className="container mx-auto flex items-center gap-4 px-4 py-3">
            <Link href="/" className="text-2xl font-extrabold whitespace-nowrap">
              <span className="text-indigo-400">My</span>City
            </Link>
            <CategoriesDropdown />
            <SearchForm className="flex-1 max-w-2xl" />
            <nav className="ml-auto flex items-center gap-5 text-sm">
              {!isLoading && <ProfileIcon />}
              <NotificationsIcon />
              <OrdersIcon />
              <CartIcon />
            </nav>
          </div>
        </div>
      </div>

      {/* CategoryBar nascosta nell'area venditore/admin */}
      {!pathname?.startsWith('/seller') && !pathname?.startsWith('/admin') && <CategoryBar />}
    </header>
  );
};

export default Navbar;
