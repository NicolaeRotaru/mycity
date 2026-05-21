'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

const Navbar = () => {
  const pathname = usePathname();
  const router = useRouter();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/sign-in');
    router.refresh();
  };

  return (
    <nav className="bg-primary-600 p-4">
      <div className="container mx-auto flex justify-between items-center">
        <Link href="/" className="text-white text-xl font-bold">
          Piacenza Market
        </Link>
        <ul className="flex space-x-6 items-center">
          <li>
            <Link
              href="/sell"
              className={pathname === '/sell' ? 'text-pink-300 font-semibold' : 'text-white hover:text-pink-200 transition-colors'}
            >
              Vendi
            </Link>
          </li>
          <li>
            <Link
              href="/orders"
              className={pathname === '/orders' ? 'text-pink-300 font-semibold' : 'text-white hover:text-pink-200 transition-colors'}
            >
              Ordini
            </Link>
          </li>
          <li>
            <button
              onClick={handleSignOut}
              className="text-white hover:text-pink-200 transition-colors"
            >
              Esci
            </button>
          </li>
        </ul>
      </div>
    </nav>
  );
};

export default Navbar;
