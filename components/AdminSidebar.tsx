'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/admin/today',          label: 'Today',          icon: '🏠' },
  { href: '/admin/funnel',         label: 'Funnel & Cohort',icon: '📈' },
  { href: '/admin',                label: 'Dashboard',      icon: '📊' },
  { href: '/admin/users',          label: 'Utenti',         icon: '👥' },
  { href: '/admin/orders',         label: 'Ordini',         icon: '📦' },
  { href: '/admin/products',       label: 'Prodotti',       icon: '🛍️' },
  { href: '/admin/coupons',        label: 'Coupon',         icon: '🎟️' },
  { href: '/admin/shop-of-month',  label: 'Negozio mese',   icon: '👑' },
  { href: '/admin/events',         label: 'Eventi',         icon: '📅' },
  { href: '/admin/sponsored',      label: 'Sponsored',      icon: '📣' },
  { href: '/admin/cashback',       label: 'Cashback',       icon: '🪙' },
  { href: '/admin/sos',            label: 'SOS Rider',      icon: '🆘' },
];

const AdminSidebar = () => {
  const pathname = usePathname();
  return (
    <aside className="bg-white border rounded-lg p-4 h-fit lg:sticky lg:top-24">
      <h2 className="font-bold mb-4 text-gray-800 flex items-center gap-2">
        <span className="text-rose-600">🛡️</span> Admin
      </h2>
      <nav className="space-y-1">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`flex items-center gap-3 px-3 py-2 rounded transition-colors ${
              pathname === l.href
                ? 'bg-rose-100 text-rose-700 font-semibold'
                : 'text-gray-700 hover:bg-gray-100'
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

export default AdminSidebar;
