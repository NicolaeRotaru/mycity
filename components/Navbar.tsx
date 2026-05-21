'use client';

import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useCartCount } from './hooks/useCartCount';
import CategoryBar from './CategoryBar';

const Navbar = () => {
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState('');
  const [user, setUser] = useState<any>(null);
  const cartCount = useCartCount();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    router.push('/sign-in');
    router.refresh();
  };

  if (pathname?.startsWith('/sign-in') || pathname?.startsWith('/sign-up')) return null;

  return (
    <header className="bg-gray-900 text-white sticky top-0 z-50 shadow">
      <div className="container mx-auto flex items-center gap-4 px-4 py-3">
        <Link href="/" className="text-2xl font-extrabold whitespace-nowrap">
          <span className="text-indigo-400">Piacenza</span>Market
        </Link>

        <form onSubmit={handleSearch} className="flex-1 max-w-2xl">
          <div className="flex">
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cerca prodotti, negozi, categorie..."
              className="w-full px-4 py-2 rounded-l-md text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <button
              type="submit"
              className="bg-indigo-500 hover:bg-indigo-600 px-4 py-2 rounded-r-md font-semibold"
            >
              🔍
            </button>
          </div>
        </form>

        <nav className="flex items-center gap-5 text-sm">
          {user ? (
            <>
              <Link href="/profile" className="hover:text-indigo-300 hidden sm:inline">
                Ciao, {user.email?.split('@')[0]}
              </Link>
              <Link href="/orders" className="hover:text-indigo-300 hidden sm:inline">Ordini</Link>
              <Link href="/seller/dashboard" className="hover:text-indigo-300">Vendi</Link>
              <button onClick={handleSignOut} className="hover:text-indigo-300">Esci</button>
            </>
          ) : (
            <>
              <Link href="/sign-in" className="hover:text-indigo-300">Accedi</Link>
              <Link href="/sign-up" className="hover:text-indigo-300 hidden sm:inline">Registrati</Link>
            </>
          )}
          <Link href="/cart" className="relative flex items-center gap-1 hover:text-indigo-300">
            <span className="text-xl">🛒</span>
            {cartCount > 0 && (
              <span className="absolute -top-2 -right-3 bg-pink-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                {cartCount}
              </span>
            )}
            <span className="hidden sm:inline">Carrello</span>
          </Link>
        </nav>
      </div>
      <CategoryBar />
    </header>
  );
};

export default Navbar;
