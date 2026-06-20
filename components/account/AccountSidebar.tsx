'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  User, Package, MapPin, Heart, Bell, Sparkles,
  Gift, UserPlus, Settings, Trophy, LogOut,
  type LucideIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useProfile } from '@/components/hooks/useProfile';

type NavItem = { href: string; icon: LucideIcon; label: string };
type NavGroup = { group: string; items: NavItem[] };

/**
 * Sidebar account acquirente — card identità (avatar + nome + "Cliente dal <anno>")
 * + nav raggruppata con stato attivo via usePathname + logout. È content-level:
 * vive SOTTO la global Navbar (questa è un'area buyer, non un'app dedicata come
 * seller/admin/rider). Logout via supabase.auth.signOut + router, come
 * SellerShell / AdminSidebar.
 */
const NAV: NavGroup[] = [
  { group: 'Account', items: [
    { href: '/profile', icon: User, label: 'Profilo' },
    { href: '/orders', icon: Package, label: 'Ordini' },
    { href: '/profile/addresses', icon: MapPin, label: 'Indirizzi' },
  ] },
  { group: 'Attività', items: [
    { href: '/favorites', icon: Heart, label: 'Preferiti' },
    { href: '/notifications', icon: Bell, label: 'Notifiche' },
  ] },
  { group: 'Premi', items: [
    { href: '/profile/loyalty', icon: Sparkles, label: 'Punti' },
    { href: '/profile/referral', icon: UserPlus, label: 'Inviti' },
    { href: '/profile/gift-cards', icon: Gift, label: 'Gift card' },
    { href: '/profile/achievements', icon: Trophy, label: 'Obiettivi' },
  ] },
  { group: 'Preferenze', items: [
    { href: '/profile/settings', icon: Settings, label: 'Impostazioni' },
  ] },
];

function isActive(pathname: string, href: string): boolean {
  // /profile è attivo solo sulla pagina esatta (le sottopagine hanno la loro voce).
  if (href === '/profile') return pathname === '/profile';
  return pathname === href || pathname.startsWith(href + '/');
}

function getInitials(name: string): string {
  return (
    name.trim().split(/\s+/).map((w) => w[0] ?? '').slice(0, 2).join('').toUpperCase() || 'U'
  );
}

/** Anno di iscrizione dall'auth user (created_at), per "Cliente dal <anno>". */
function useMemberSince() {
  const { data } = useQuery({
    queryKey: ['account', 'member-since'],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<number | null> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.created_at) return null;
      const year = new Date(user.created_at).getFullYear();
      return Number.isFinite(year) ? year : null;
    },
  });
  return data ?? null;
}

export default function AccountSidebar() {
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const { profile, userEmail } = useProfile();
  const since = useMemberSince();

  const name = profile?.full_name || profile?.email || userEmail || 'Il mio account';
  const email = profile?.email || userEmail || '';
  const logo = profile?.store_logo || null;
  const initials = getInitials(name);

  const [signingOut, setSigningOut] = useState(false);
  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    await supabase.auth.signOut();
    router.push('/sign-in');
    router.refresh();
  };

  return (
    <nav aria-label="Menu account" className="flex flex-col gap-3">
      {/* Card identità */}
      <div className="rounded-xl border border-cream-300 bg-white p-4">
        <div className="flex items-center gap-3">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logo}
              alt=""
              className="h-12 w-12 shrink-0 rounded-full object-cover"
            />
          ) : (
            <span
              aria-hidden
              className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary-500 to-primary-700 text-[17px] font-bold text-white"
            >
              {initials}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate font-serif text-[15px] font-bold text-ink-900">{name}</p>
            <p className="truncate text-[12px] text-ink-500">
              {since ? `Cliente dal ${since}` : email}
            </p>
          </div>
        </div>
      </div>

      {/* Nav raggruppata */}
      <div className="flex flex-col gap-2">
        {NAV.map((sec) => (
          <div key={sec.group}>
            <p className="mb-1 px-3 text-[10px] font-bold uppercase tracking-[0.08em] text-ink-400">
              {sec.group}
            </p>
            <ul className="flex flex-col gap-0.5">
              {sec.items.map((n) => {
                const on = isActive(pathname, n.href);
                const Icon = n.icon;
                return (
                  <li key={n.href}>
                    <Link
                      href={n.href}
                      aria-current={on ? 'page' : undefined}
                      className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[14px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ${
                        on
                          ? 'bg-primary-50 font-bold text-primary-800'
                          : 'font-medium text-ink-700 hover:bg-cream-100 hover:text-ink-900'
                      }`}
                    >
                      <Icon
                        size={18}
                        strokeWidth={2.2}
                        className={`shrink-0 ${on ? 'text-primary-700' : 'text-ink-500'}`}
                        aria-hidden
                      />
                      {n.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {/* Logout */}
      <button
        type="button"
        onClick={handleSignOut}
        disabled={signingOut}
        className="mt-1 flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[14px] font-medium text-ink-500 transition-colors hover:bg-secondary-50 hover:text-secondary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 disabled:opacity-60"
      >
        <LogOut size={18} strokeWidth={2.2} className="shrink-0 text-ink-400" aria-hidden />
        Esci
      </button>
    </nav>
  );
}
