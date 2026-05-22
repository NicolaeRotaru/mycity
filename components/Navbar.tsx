'use client';

import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { useCartCount } from './hooks/useCartCount';
import { useProfile } from './hooks/useProfile';
import CategoryBar from './CategoryBar';
import TrustBar from './TrustBar';

const Navbar = () => {
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const cartCount = useCartCount();
  const { profile, userEmail, isAuthenticated, isLoading, isSeller, isBuyer } = useProfile();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    qc.clear();
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
  const isAuthUnknownRole = isAuthenticated && !isBuyer && !isSeller;

  return (
    <header className="sticky top-0 z-50 shadow-lg">
      <TrustBar />
      <div className="bg-gray-900 text-white">
      <div className="container mx-auto flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3">
        <Link href="/" className="text-xl sm:text-2xl font-extrabold whitespace-nowrap">
          <span className="text-indigo-400">Piacenza</span>Market
        </Link>

        <form
          onSubmit={handleSearch}
          className="order-3 w-full md:order-none md:flex-1 md:max-w-2xl md:w-auto"
        >
          <div className="flex">
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cerca prodotti, negozi..."
              className="w-full px-4 py-2 rounded-l-md text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-400 text-sm sm:text-base"
            />
            <button type="submit" className="bg-indigo-500 hover:bg-indigo-600 px-4 py-2 rounded-r-md font-semibold">
              🔍
            </button>
          </div>
        </form>

        <nav className="ml-auto flex items-center gap-3 sm:gap-5 text-sm">
          {!isAuthenticated && !isLoading && (
            <>
              <Link href="/sign-in" className="hover:text-indigo-300">Accedi</Link>
              <Link href="/sign-up" className="hover:text-indigo-300 hidden sm:inline">Registrati</Link>
            </>
          )}

          {isAuthUnknownRole && (
            <>
              <Link
                href="/profile"
                title="Il tuo account"
                className="flex items-center gap-2 hover:text-indigo-300 transition-colors"
              >
                <span className="w-8 h-8 rounded-full bg-indigo-500/20 border border-indigo-400/40 flex items-center justify-center text-sm font-bold uppercase">
                  {(displayName?.[0] ?? '?')}
                </span>
                <span className="hidden sm:flex flex-col leading-tight">
                  <span className="text-[10px] text-gray-400 uppercase tracking-wide">Ciao</span>
                  <span className="font-semibold">{displayName || 'utente'}</span>
                </span>
              </Link>
              <button onClick={handleSignOut} title="Esci" className="hover:text-indigo-300 transition-colors">
                <span className="hidden sm:inline">Esci</span>
                <span className="sm:hidden text-lg">↪</span>
              </button>
            </>
          )}

          {isBuyer && (
            <>
              <Link
                href="/profile"
                title="Il tuo account"
                className="flex items-center gap-2 hover:text-indigo-300 transition-colors"
              >
                <span className="w-8 h-8 rounded-full bg-indigo-500/20 border border-indigo-400/40 flex items-center justify-center text-sm font-bold uppercase">
                  {(displayName?.[0] ?? '?')}
                </span>
                <span className="hidden sm:flex flex-col leading-tight">
                  <span className="text-[10px] text-gray-400 uppercase tracking-wide">Ciao</span>
                  <span className="font-semibold">{displayName}</span>
                </span>
              </Link>
              <Link
                href="/orders"
                title="I tuoi ordini"
                className="flex items-center gap-1.5 hover:text-indigo-300 transition-colors"
              >
                <span className="text-lg">📦</span>
                <span className="hidden sm:inline">Ordini</span>
              </Link>
              <Link
                href="/sell"
                className="bg-pink-500 hover:bg-pink-600 px-3 py-1.5 rounded font-semibold whitespace-nowrap text-xs sm:text-sm"
              >
                Diventa venditore
              </Link>
              <button onClick={handleSignOut} title="Esci" className="hover:text-indigo-300 transition-colors">
                <span className="hidden sm:inline">Esci</span>
                <span className="sm:hidden text-lg">↪</span>
              </button>
            </>
          )}

          {isSeller && (
            <>
              <Link
                href="/seller/profile"
                title="Profilo negozio"
                className="flex items-center gap-2 hover:text-indigo-300 transition-colors"
              >
                <span className="w-8 h-8 rounded-full bg-pink-500/20 border border-pink-400/40 flex items-center justify-center text-sm">
                  🏪
                </span>
                <span className="hidden sm:flex flex-col leading-tight">
                  <span className="text-[10px] text-gray-400 uppercase tracking-wide">Negozio</span>
                  <span className="font-semibold truncate max-w-[120px]">{displayName}</span>
                </span>
              </Link>
              <Link
                href="/seller/dashboard"
                className="bg-indigo-500 hover:bg-indigo-600 px-3 py-1.5 rounded font-semibold whitespace-nowrap text-xs sm:text-sm"
              >
                Area venditore
              </Link>
              <Link
                href="/seller/orders"
                title="Ordini ricevuti"
                className="flex items-center gap-1.5 hover:text-indigo-300 transition-colors"
              >
                <span className="text-lg">📦</span>
                <span className="hidden sm:inline">Ordini</span>
              </Link>
              <button onClick={handleSignOut} title="Esci" className="hover:text-indigo-300 transition-colors">
                <span className="hidden sm:inline">Esci</span>
                <span className="sm:hidden text-lg">↪</span>
              </button>
            </>
          )}

          {/* Carrello: visibile solo a buyer e ospiti, non ai seller */}
          {!isSeller && (
            <Link href="/cart" className="relative flex items-center gap-1 hover:text-indigo-300">
              <span className="text-xl">🛒</span>
              {cartCount > 0 && (
                <span className="absolute -top-2 -right-3 bg-pink-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                  {cartCount}
                </span>
              )}
              <span className="hidden sm:inline">Carrello</span>
            </Link>
          )}
        </nav>
      </div>

      </div>
      {/* CategoryBar nascosta nell'area venditore */}
      {!pathname?.startsWith('/seller') && !pathname?.startsWith('/admin') && <CategoryBar />}
    </header>
  );
};

export default Navbar;
