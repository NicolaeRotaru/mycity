'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Sun, LayoutDashboard, Receipt, Users, Gavel, Banknote, Siren,
  TrendingUp, Ticket, Megaphone, Zap, Crown, CalendarDays,
  LayoutTemplate, FileText, FolderTree, Palette, Rss, ScrollText, LifeBuoy,
  type LucideIcon,
} from 'lucide-react';
import { useProfile } from '@/components/hooks/useProfile';

type NavItem = { href: string; icon: LucideIcon; label: string };
type NavGroup = { group: string; items: NavItem[] };

/**
 * Admin "founder cockpit" — sidebar scura allineata al design system (kit admin v2).
 * Su desktop sostituisce la navigazione admin via menu account; su mobile resta la
 * MobileTabBar (questa sidebar è `hidden md:flex`). Le voci linkano SOLO a route
 * admin esistenti, raggruppate come nel mockup.
 */
const NAV: NavGroup[] = [
  { group: 'Operatività', items: [
    { href: '/admin/today', icon: Sun, label: 'Today' },
    { href: '/admin', icon: LayoutDashboard, label: 'Panoramica' },
    { href: '/admin/orders', icon: Receipt, label: 'Ordini' },
    { href: '/admin/users', icon: Users, label: 'Utenti' },
  ] },
  { group: 'Trust & Safety', items: [
    { href: '/admin/disputes', icon: Gavel, label: 'Reclami' },
    { href: '/admin/cod-remittance', icon: Banknote, label: 'Rimesse COD' },
    { href: '/admin/sos', icon: Siren, label: 'SOS rider' },
  ] },
  { group: 'Crescita', items: [
    { href: '/admin/funnel', icon: TrendingUp, label: 'Funnel & Cohort' },
    { href: '/admin/coupons', icon: Ticket, label: 'Coupon' },
    { href: '/admin/sponsored', icon: Megaphone, label: 'Sponsorizzati' },
    { href: '/admin/daily-drops', icon: Zap, label: 'Daily drops' },
    { href: '/admin/shop-of-month', icon: Crown, label: 'Negozio del mese' },
    { href: '/admin/events', icon: CalendarDays, label: 'Eventi' },
  ] },
  { group: 'Contenuti', items: [
    { href: '/admin/home', icon: LayoutTemplate, label: 'Home builder' },
    { href: '/admin/pages', icon: FileText, label: 'Pagine' },
    { href: '/admin/categories', icon: FolderTree, label: 'Categorie' },
    { href: '/admin/branding', icon: Palette, label: 'Branding' },
  ] },
  { group: 'Sistema', items: [
    { href: '/admin/activity', icon: Rss, label: 'Attività' },
    { href: '/admin/audit', icon: ScrollText, label: 'Audit log' },
    { href: '/admin/support', icon: LifeBuoy, label: 'Supporto' },
  ] },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/admin') return pathname === '/admin';
  return pathname === href || pathname.startsWith(href + '/');
}

export default function AdminSidebar() {
  const pathname = usePathname() ?? '';
  const { profile, userEmail } = useProfile();
  const name = profile?.full_name || profile?.email || userEmail || 'Admin';
  const initials =
    name.trim().split(/\s+/).map((w) => w[0] ?? '').slice(0, 2).join('').toUpperCase() || 'A';

  return (
    <aside className="hidden md:flex sticky top-0 h-screen w-[248px] flex-col bg-ink-900 text-white">
      <div className="shrink-0 border-b border-white/10 px-5 pb-3.5 pt-5">
        <div className="font-serif text-[22px] font-extrabold leading-none tracking-tight">
          <span className="text-accent-300">My</span>
          <span className="text-white">City</span>
          <span className="ml-1.5 font-sans text-[11px] font-bold uppercase tracking-[0.08em] text-secondary-300">
            Admin
          </span>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-3">
        {NAV.map((sec) => (
          <div key={sec.group} className="mb-2">
            <p className="mx-3 mb-1 mt-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-white/40">
              {sec.group}
            </p>
            {sec.items.map((n) => {
              const on = isActive(pathname, n.href);
              const Icon = n.icon;
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={on ? 'page' : undefined}
                  className={`flex items-center gap-2.5 rounded-md px-3 py-2.5 text-[13.5px] transition-colors ${
                    on
                      ? 'bg-primary-700 font-bold text-white'
                      : 'font-medium text-white/[0.78] hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <Icon size={17} strokeWidth={2.2} className="shrink-0" aria-hidden />
                  {n.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-white/10 p-3">
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          <span className="inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-secondary-600 text-[13px] font-bold text-white">
            {initials}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-bold text-white">{name}</p>
            <p className="text-[11px] text-white/50">Admin</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
