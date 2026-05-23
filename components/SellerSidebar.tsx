'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/seller/dashboard',     label: 'Dashboard',         icon: '📊' },
  { href: '/seller/products',      label: 'I miei prodotti',   icon: '📦' },
  { href: '/seller/products/new',  label: 'Nuovo prodotto',    icon: '➕' },
  { href: '/seller/orders',        label: 'Ordini ricevuti',   icon: '🛒' },
  { href: '/seller/customers',     label: 'I miei clienti',    icon: '👥' },
  { href: '/seller/profile',       label: 'Profilo negozio',   icon: '🏪' },
];

const SellerSidebar = () => {
  const pathname = usePathname();
  return (
    <aside className="bg-white border rounded-lg p-4 h-fit lg:sticky lg:top-24">
      <h2 className="font-bold mb-4 text-gray-800">Area venditore</h2>
      <nav className="space-y-1">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`flex items-center gap-3 px-3 py-2 rounded transition-colors ${
              pathname === l.href ? 'bg-indigo-100 text-indigo-700 font-semibold' : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            <span>{l.icon}</span>
            <span>{l.label}</span>
          </Link>
        ))}
      </nav>
    </aside>
  );
};

export default SellerSidebar;
