'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/rider',          label: 'Dashboard',     icon: '🛵' },
  { href: '/rider/history',  label: 'Storico',       icon: '📜' },
  { href: '/rider/profile',  label: 'Profilo',       icon: '👤' },
];

const RiderSidebar = () => {
  const pathname = usePathname();
  return (
    <aside className="bg-white border rounded-lg p-4 h-fit lg:sticky lg:top-24">
      <h2 className="font-bold mb-4 text-gray-800">Area rider</h2>
      <nav className="space-y-1">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`flex items-center gap-3 px-3 py-2 rounded transition-colors ${
              pathname === l.href ? 'bg-amber-100 text-amber-700 font-semibold' : 'text-gray-700 hover:bg-gray-100'
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

export default RiderSidebar;
