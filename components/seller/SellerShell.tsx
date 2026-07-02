'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard, Receipt, Package, Wand2,
  Tag, Megaphone, Camera, BarChart3,
  Users, Star, Wallet,
  Store, User, LifeBuoy,
  Sparkles, Bell, Search, Plus, Menu, X,
  PanelLeftClose, PanelLeftOpen, ExternalLink, LogOut,
  type LucideIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useProfile } from '@/components/hooks/useProfile';
import { queryKeys } from '@/lib/queries/keys';

type NavItem = { href: string; icon: LucideIcon; label: string; badge?: 'todo' };
type NavGroup = { group: string; items: NavItem[] };

/**
 * Seller shell — sidebar scura (ink-900) + topbar bianca sticky + Copilot.
 * Mirroring delle convenzioni di components/admin/AdminSidebar (logout via
 * supabase.auth.signOut + router, attivo via usePathname). La global chrome
 * (Navbar/Footer/MobileTabBar) si nasconde su /seller esattamente come su /admin.
 */
const NAV: NavGroup[] = [
  { group: 'Gestione', items: [
    { href: '/seller/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { href: '/seller/orders', icon: Receipt, label: 'Ordini', badge: 'todo' },
    { href: '/seller/products', icon: Package, label: 'Prodotti' },
    { href: '/seller/products/ai-batch', icon: Wand2, label: 'AI Studio' },
  ] },
  { group: 'Crescita', items: [
    { href: '/seller/promotions', icon: Tag, label: 'Promozioni' },
    { href: '/seller/promote', icon: Megaphone, label: 'Sponsorizza' },
    { href: '/seller/stories', icon: Camera, label: 'Storie' },
    { href: '/seller/analytics', icon: BarChart3, label: 'Analisi' },
  ] },
  { group: 'Relazioni', items: [
    { href: '/seller/customers', icon: Users, label: 'Clienti' },
    { href: '/seller/reviews', icon: Star, label: 'Recensioni' },
    { href: '/seller/earnings', icon: Wallet, label: 'Guadagni' },
  ] },
  { group: 'Negozio', items: [
    { href: '/seller/site', icon: Store, label: 'La tua vetrina' },
    { href: '/seller/profile', icon: User, label: 'Profilo' },
    { href: '/seller/help', icon: LifeBuoy, label: 'Aiuto' },
  ] },
];

const COPILOT_HREF = '/seller/products/ai-batch';

function isActive(pathname: string, href: string): boolean {
  if (href === '/seller/dashboard') {
    // Dashboard attivo anche sulla root /seller (redirect verso la dashboard).
    return pathname === '/seller/dashboard' || pathname === '/seller';
  }
  // Tiene attiva solo la voce più specifica: products non resta attivo su
  // products/ai-batch (che ha la sua voce AI Studio).
  if (href === '/seller/products') {
    return pathname === '/seller/products' || pathname.startsWith('/seller/products/');
  }
  return pathname === href || pathname.startsWith(href + '/');
}

/** Conta gli ordini "da fare" del venditore — stesso filtro della pagina ordini. */
function useSellerTodoCount() {
  const { data = 0 } = useQuery({
    queryKey: [...queryKeys.seller.orders, 'todo-count'],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return 0;
      const { count, error } = await supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('seller_id', user.id)
        .in('delivery_status', ['NEW', 'ACCEPTED', 'READY']);
      if (error) return 0;
      return count ?? 0;
    },
  });
  return data;
}

/** Conta le notifiche non lette per il pallino del campanello. */
function useNotifUnread() {
  const { data = 0 } = useQuery({
    queryKey: [...queryKeys.notifications.count, 'seller-bell'],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return 0;
      const { count, error } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('is_read', false);
      if (error) return 0;
      return count ?? 0;
    },
  });
  return data;
}

function NotifPopover({ unread, onClose }: { unread: number; onClose: () => void }) {
  return (
    <>
      <div
        onClick={onClose}
        aria-hidden
        className="fixed inset-0 z-dropdown"
      />
      <div
        role="dialog"
        aria-label="Notifiche"
        className="absolute right-0 top-[calc(100%+10px)] z-modal w-[330px] max-w-[88vw] overflow-hidden rounded-xl border border-cream-200 bg-surface-0 text-ink-900 shadow-warm-xl"
      >
        <div className="flex items-center justify-between border-b border-cream-200 px-4 py-3">
          <span className="font-serif text-[16px] font-bold">Notifiche</span>
          {unread > 0 && (
            <span className="text-[12px] font-semibold text-primary-700">{unread} non lette</span>
          )}
        </div>
        <div className="px-4 py-6 text-center text-sm text-ink-500">
          {unread > 0
            ? `Hai ${unread} ${unread === 1 ? 'notifica non letta' : 'notifiche non lette'}.`
            : 'Nessuna nuova notifica.'}
        </div>
        <Link
          href="/notifications"
          onClick={onClose}
          className="block w-full border-t border-cream-200 bg-cream-50 px-4 py-3 text-center text-[13px] font-semibold text-ink-700 hover:bg-cream-100"
        >
          Centro notifiche
        </Link>
      </div>
    </>
  );
}

export default function SellerShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const { profile, userEmail } = useProfile();

  const [collapsed, setCollapsed] = useState(false);
  const [navOpen, setNavOpen] = useState(false);     // mobile off-canvas drawer
  const [notifOpen, setNotifOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const todo = useSellerTodoCount();
  const notifUnread = useNotifUnread();

  const storeName = profile?.store_name || profile?.full_name || profile?.email || userEmail || 'Negozio';
  const initials =
    storeName.trim().split(/\s+/).map((w) => w[0] ?? '').slice(0, 2).join('').toUpperCase() || 'S';

  // Chiude il drawer mobile a ogni cambio rotta.
  useEffect(() => { setNavOpen(false); }, [pathname]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/sign-in');
    router.refresh();
  };

  const onSearchSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const q = searchRef.current?.value.trim();
    router.push(q ? `/seller/products?q=${encodeURIComponent(q)}` : '/seller/products');
  };

  // Larghezza sidebar: collapsed solo su desktop (lg+). Su mobile è full-drawer.
  const asideWidth = collapsed ? 'lg:w-[76px]' : 'lg:w-[248px]';

  return (
    <div className="min-h-screen bg-cream-100 lg:flex">
      {/* Backdrop drawer mobile */}
      {navOpen && (
        <div
          onClick={() => setNavOpen(false)}
          aria-hidden
          className="fixed inset-0 z-modal bg-black/45 lg:hidden"
        />
      )}

      {/* SIDEBAR */}
      <aside
        className={`fixed inset-y-0 left-0 z-modal flex h-screen w-[260px] max-w-[82vw] flex-col bg-ink-900 text-white transition-transform duration-200 ${
          navOpen ? 'translate-x-0' : '-translate-x-full'
        } lg:sticky lg:top-0 lg:z-base lg:max-w-none lg:translate-x-0 ${asideWidth}`}
        aria-label="Menu venditore"
      >
        {/* Brand + collapse */}
        <div
          className={`flex shrink-0 items-center gap-2 border-b border-white/10 px-4 pb-3.5 pt-5 ${
            collapsed ? 'lg:justify-center lg:px-2.5' : 'justify-between'
          }`}
        >
          {!collapsed && (
            <Link href="/seller/dashboard" className="font-serif text-[22px] font-extrabold leading-none tracking-tight">
              <span className="text-accent-300">My</span>
              <span className="text-white">City</span>
              <span className="ml-1.5 font-sans text-[11px] font-bold uppercase tracking-[0.08em] text-ink-300">
                Seller
              </span>
            </Link>
          )}
          {/* Collapse — desktop */}
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Espandi menu' : 'Comprimi menu'}
            title={collapsed ? 'Espandi menu' : 'Comprimi menu'}
            className="hidden h-[34px] w-[34px] shrink-0 items-center justify-center rounded-md bg-white/10 text-white hover:bg-white/20 lg:inline-flex"
          >
            {collapsed ? <PanelLeftOpen size={18} aria-hidden /> : <PanelLeftClose size={18} aria-hidden />}
          </button>
          {/* Chiudi drawer — mobile */}
          <button
            type="button"
            onClick={() => setNavOpen(false)}
            aria-label="Chiudi menu"
            className="inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-md bg-white/10 text-white hover:bg-white/20 lg:hidden"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        {/* Copilot — gestisci parlando */}
        <div className={`shrink-0 px-3 pb-1 pt-3 ${collapsed ? 'lg:px-2.5' : ''}`}>
          <Link
            href={COPILOT_HREF}
            title="Copilot — gestisci parlando"
            className={`flex w-full items-center gap-2.5 rounded-lg bg-gradient-to-br from-primary-600 to-secondary-600 px-3.5 py-3 text-left text-white shadow-warm hover:from-primary-700 hover:to-secondary-700 ${
              collapsed ? 'lg:justify-center lg:px-2.5' : ''
            }`}
          >
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/20">
              <Sparkles size={18} aria-hidden />
            </span>
            {!collapsed && (
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-extrabold">Copilot</span>
                <span className="block text-[11px] text-white/80">Gestisci parlando</span>
              </span>
            )}
          </Link>
        </div>

        {/* Nav */}
        <nav className={`flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-2 ${collapsed ? 'lg:px-2' : ''}`}>
          {NAV.map((sec) => (
            <div key={sec.group} className="mb-1.5">
              {!collapsed && (
                <p className="mx-3 mb-1 mt-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-white/40">
                  {sec.group}
                </p>
              )}
              {sec.items.map((n) => {
                const on = isActive(pathname, n.href);
                const Icon = n.icon;
                const showBadge = n.badge === 'todo' && todo > 0;
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    aria-current={on ? 'page' : undefined}
                    title={n.label}
                    className={`relative flex items-center gap-2.5 rounded-md px-3 py-2.5 text-[13.5px] transition-colors ${
                      collapsed ? 'lg:justify-center lg:px-2.5' : ''
                    } ${
                      on
                        ? 'bg-primary-700 font-bold text-white'
                        : 'font-medium text-white/[0.78] hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    <Icon size={17} strokeWidth={2.2} className="shrink-0" aria-hidden />
                    {!collapsed && <span className="flex-1">{n.label}</span>}
                    {/* Badge esteso */}
                    {showBadge && !collapsed && (
                      <span className="ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-accent-500 px-1.5 text-[11px] font-bold text-ink-900">
                        {todo > 99 ? '99+' : todo}
                      </span>
                    )}
                    {/* Badge collapsed: pallino in alto a destra */}
                    {showBadge && collapsed && (
                      <span className="absolute right-2 top-1.5 h-2 w-2 rounded-full bg-accent-500" aria-hidden />
                    )}
                    {showBadge && (
                      <span className="sr-only">{todo} ordini da gestire</span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Footer: marketplace + logout */}
        <div className={`shrink-0 border-t border-white/10 p-3 ${collapsed ? 'lg:px-2' : ''}`}>
          <Link
            href="/?shop=1"
            title="Vai al marketplace"
            className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium text-white/[0.78] transition-colors hover:bg-white/5 hover:text-white ${
              collapsed ? 'lg:justify-center lg:px-2.5' : ''
            }`}
          >
            <ExternalLink size={16} strokeWidth={2.2} className="shrink-0" aria-hidden />
            {!collapsed && <span>Vai al marketplace</span>}
          </Link>
          <button
            type="button"
            onClick={handleSignOut}
            title="Esci"
            className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-[13px] font-medium text-white/[0.78] transition-colors hover:bg-secondary-600/20 hover:text-white ${
              collapsed ? 'lg:justify-center lg:px-2.5' : ''
            }`}
          >
            <LogOut size={16} strokeWidth={2.2} className="shrink-0" aria-hidden />
            {!collapsed && <span>Esci</span>}
          </button>
        </div>
      </aside>

      {/* MAIN COLUMN */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* TOPBAR */}
        <header className="sticky top-0 z-sticky flex items-center gap-4 border-b border-cream-300 bg-surface-0 px-4 py-3 sm:px-6 lg:px-7">
          {/* Hamburger — mobile */}
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label="Apri menu"
            className="inline-flex shrink-0 items-center justify-center rounded-md p-1.5 text-ink-700 hover:bg-cream-100 lg:hidden"
          >
            <Menu size={22} aria-hidden />
          </button>

          {/* Search pill */}
          <form onSubmit={onSearchSubmit} role="search" className="relative min-w-0 flex-1 sm:max-w-[380px]">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400">
              <Search size={17} aria-hidden />
            </span>
            <input
              ref={searchRef}
              type="search"
              name="q"
              aria-label="Cerca ordini, prodotti, clienti"
              placeholder="Cerca ordini, prodotti, clienti…"
              className="w-full rounded-full border border-cream-300 bg-cream-50 py-2.5 pl-10 pr-4 text-sm text-ink-900 outline-none placeholder:text-ink-400 focus-visible:border-primary-400 focus-visible:ring-2 focus-visible:ring-primary-400"
            />
          </form>

          <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
            {/* Pubblica prodotto */}
            <Link
              href="/seller/products/new"
              className="inline-flex items-center gap-1.5 rounded-full bg-primary-700 px-3.5 py-2.5 text-[13px] font-bold text-white shadow-warm-sm transition-colors hover:bg-primary-800"
            >
              <Plus size={16} strokeWidth={2.4} aria-hidden />
              <span className="hidden sm:inline">Pubblica prodotto</span>
            </Link>

            {/* Notifiche */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setNotifOpen((o) => !o)}
                aria-label="Notifiche"
                aria-haspopup="dialog"
                aria-expanded={notifOpen}
                className="relative inline-flex items-center justify-center rounded-full p-2 text-ink-600 hover:bg-cream-100"
              >
                <Bell size={20} aria-hidden />
                {notifUnread > 0 && (
                  <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-secondary-600" aria-hidden />
                )}
              </button>
              {notifOpen && <NotifPopover unread={notifUnread} onClose={() => setNotifOpen(false)} />}
            </div>

            {/* Avatar negozio */}
            <Link href="/seller/profile" className="flex items-center gap-2" title={storeName}>
              <span className="inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary-500 to-primary-700 text-[13px] font-bold text-white">
                {initials}
              </span>
              <span className="hidden leading-tight md:block">
                <span className="block max-w-[140px] truncate text-[13px] font-bold text-ink-900">{storeName}</span>
                <span className="block text-[11px] text-ink-400">Venditore</span>
              </span>
            </Link>
          </div>
        </header>

        {/* CONTENT */}
        <main className="w-full max-w-[1100px] flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-7">
          {children}
        </main>
      </div>

      {/* Copilot FAB — sempre raggiungibile */}
      {pathname !== COPILOT_HREF && (
        <Link
          href={COPILOT_HREF}
          aria-label="Chiedi al Copilot"
          title="Chiedi al Copilot"
          className="fixed bottom-6 right-6 z-overlay inline-flex items-center gap-2 rounded-full bg-gradient-to-br from-primary-600 to-secondary-600 px-4 py-3.5 text-[14px] font-bold text-white shadow-warm-xl hover:from-primary-700 hover:to-secondary-700"
        >
          <Sparkles size={19} aria-hidden />
          <span className="hidden sm:inline">Copilot</span>
        </Link>
      )}
    </div>
  );
}
