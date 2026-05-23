'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type Item =
  | { type: 'link'; href: string; label: string; icon: string }
  | { type: 'section'; label: string };

const items: Item[] = [
  { type: 'section', label: 'Operatività' },
  { type: 'link', href: '/rider',              label: 'Dashboard',         icon: '🛵' },
  { type: 'link', href: '/rider/availability', label: 'Disponibilità',     icon: '🟢' },
  { type: 'link', href: '/rider/history',      label: 'Storico consegne',  icon: '📜' },

  { type: 'section', label: 'Business' },
  { type: 'link', href: '/rider/earnings',     label: 'Guadagni',          icon: '💶' },
  { type: 'link', href: '/rider/reviews',      label: 'Recensioni',        icon: '⭐' },

  { type: 'section', label: 'Account' },
  { type: 'link', href: '/rider/profile',      label: 'Profilo',           icon: '👤' },
  { type: 'link', href: '/profile/settings',   label: 'Impostazioni',      icon: '⚙️' },
  { type: 'link', href: '/notifications',      label: 'Notifiche',         icon: '🔔' },

  { type: 'section', label: 'Aiuto' },
  { type: 'link', href: '/rider/help',         label: 'Centro rider',      icon: '💡' },
  { type: 'link', href: '/faq',                label: 'FAQ',               icon: '❓' },
  { type: 'link', href: '/contact',            label: 'Contattaci',        icon: '✉️' },
];

const RiderSidebar = () => {
  const pathname = usePathname();
  return (
    <aside className="bg-white border rounded-lg p-4 h-fit lg:sticky lg:top-24">
      <h2 className="font-bold mb-3 text-gray-800">Area rider</h2>
      <nav className="space-y-0.5">
        {items.map((it, i) => {
          if (it.type === 'section') {
            return (
              <div
                key={`sec-${i}`}
                className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-widest text-gray-400 font-bold first:pt-0"
              >
                {it.label}
              </div>
            );
          }
          const active = pathname === it.href;
          return (
            <Link
              key={it.href}
              href={it.href}
              className={`flex items-center gap-3 px-3 py-2 rounded transition-colors text-sm ${
                active
                  ? 'bg-amber-100 text-amber-700 font-semibold'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <span className="text-base">{it.icon}</span>
              <span>{it.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
};

export default RiderSidebar;
