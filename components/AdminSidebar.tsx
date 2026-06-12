'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home, TrendingUp, LayoutDashboard, Users, ShoppingBag, Package,
  Ticket, Crown, Calendar, Megaphone, AlertTriangle, Shield, Headset,
  type LucideIcon,
} from 'lucide-react';

const links: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/admin/today',          label: 'Today',          icon: Home },
  { href: '/admin/funnel',         label: 'Funnel & Cohort',icon: TrendingUp },
  { href: '/admin',                label: 'Dashboard',      icon: LayoutDashboard },
  { href: '/admin/users',          label: 'Utenti',         icon: Users },
  { href: '/admin/orders',         label: 'Ordini',         icon: ShoppingBag },
  { href: '/admin/products',       label: 'Prodotti',       icon: Package },
  { href: '/admin/support-chat',   label: 'Chat assistenza',icon: Headset },
  { href: '/admin/coupons',        label: 'Coupon',         icon: Ticket },
  { href: '/admin/shop-of-month',  label: 'Negozio mese',   icon: Crown },
  { href: '/admin/events',         label: 'Eventi',         icon: Calendar },
  { href: '/admin/sponsored',      label: 'Sponsored',      icon: Megaphone },
  { href: '/admin/sos',            label: 'SOS Rider',      icon: AlertTriangle },
];

const AdminSidebar = () => {
  const pathname = usePathname();
  return (
    <aside className="bg-white border border-cream-300 rounded-lg p-4 h-fit lg:sticky lg:top-24">
      <h2 className="font-bold mb-4 text-ink-800 flex items-center gap-2">
        <Shield size={16} className="text-primary-700" strokeWidth={2.4} aria-hidden />
        Admin
      </h2>
      <nav className="space-y-1">
        {links.map((l) => {
          const active = pathname === l.href;
          const Icon = l.icon;
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`flex items-center gap-3 px-3 py-2 rounded transition-colors ${
                active
                  ? 'bg-primary-100 text-primary-800 font-semibold'
                  : 'text-ink-700 hover:bg-cream-100'
              }`}
            >
              <Icon size={16} strokeWidth={2.2} className={active ? 'text-primary-700' : 'text-ink-500'} aria-hidden />
              <span>{l.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
};

export default AdminSidebar;
