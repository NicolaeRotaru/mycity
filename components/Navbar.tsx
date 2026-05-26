'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Bell, MessageCircle, ShoppingCart, Heart, Bike, Shield, Store, LogOut,
  Sparkles, Package, ChevronDown, User, MapPin, Award, Gift, ListChecks,
  Megaphone, LayoutDashboard, TrendingUp, Camera, Euro, Wallet, CircleDot,
  Settings, HelpCircle,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useProfile } from './hooks/useProfile';
import { useCartCount } from './hooks/useCartCount';
import { useNotificationsCount } from './hooks/useNotificationsCount';
import { useMessagesUnread } from './hooks/useMessagesUnread';
import { useFavorites } from './hooks/useFavorites';
import LocationPill from './LocationPill';
import PromoTicker from './PromoTicker';
import SearchBar from './SearchBar';
import CategoryBar from './CategoryBar';

type Role = 'buyer' | 'seller' | 'rider' | 'admin' | null;

/**
 * Navbar redesignata "Mediterranean Modern":
 *  - top: PromoTicker (ticker rotante con highlight)
 *  - main: logo · LocationPill · SearchBar · accountCluster
 *  - sub: CategoryBar sticky (no auto-hide, l'utente la deve sempre vedere)
 *  - mobile: una riga compatta in alto + MobileTabBar in fondo (in layout)
 *
 * Si nasconde solo su sign-in / sign-up (auth flow distraction-free).
 */
export default function Navbar() {
  const router = useRouter();
  const pathname = usePathname();
  const { profile, userEmail, isAuthenticated, isLoading, isSeller, isRider, isAdmin } = useProfile();
  const cartCount = useCartCount();
  const notifCount = useNotificationsCount();
  const msgUnread = useMessagesUnread();
  const { favorites } = useFavorites();
  const favCount = favorites.size;

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/sign-in');
    router.refresh();
  };

  if (pathname?.startsWith('/sign-in') || pathname?.startsWith('/sign-up')) return null;

  const role: Role =
    isAdmin ? 'admin' :
    isSeller ? 'seller' :
    isRider ? 'rider' :
    isAuthenticated ? 'buyer' : null;

  const displayName =
    profile?.full_name?.split(' ')[0] ??
    profile?.store_name ??
    profile?.email?.split('@')[0] ??
    userEmail?.split('@')[0] ??
    'utente';

  const profileHref = isSeller ? '/seller/profile' : isRider ? '/rider/profile' : '/profile';

  // CategoryBar mostrata solo per buyer/guest in aree pubbliche (no /seller, /rider, /admin)
  const isProArea =
    !!pathname?.startsWith('/seller') ||
    !!pathname?.startsWith('/rider') ||
    !!pathname?.startsWith('/admin');
  const showCategoryBar = !isProArea && !isSeller && !isRider && !isAdmin;

  return (
    <header className="sticky top-0 z-40 shadow-warm-sm">
      <PromoTicker />

      {/* MAIN — bg primary (terracotta), accenti accent (mustard) */}
      <div className="bg-primary-700 text-white">
        {/* DESKTOP */}
        <div className="hidden md:block">
          <div className="container mx-auto px-4 py-3">
            <div className="flex items-center gap-4">
              <Link href="/" className="text-2xl font-serif font-bold tracking-tight whitespace-nowrap leading-none">
                <span className="text-accent-300">My</span>City
              </Link>
              <LocationPill />
              <div className="flex-1 max-w-2xl">
                <SearchBar />
              </div>

              <nav className="ml-auto flex items-center gap-2 text-sm">
                {!isAuthenticated && !isLoading && (
                  <>
                    <Link href="/sign-in" className="px-3 py-2 hover:text-accent-300 font-medium">Accedi</Link>
                    <Link href="/sign-up" className="bg-accent-500 hover:bg-accent-600 text-ink-900 px-4 py-2 rounded-full font-semibold transition-colors">
                      Registrati
                    </Link>
                  </>
                )}

                {isAuthenticated && (
                  <>
                    {role === 'buyer' && (
                      <IconButton href="/favorites" label="Preferiti" badge={favCount}>
                        <Heart size={20} strokeWidth={2} />
                      </IconButton>
                    )}
                    <IconButton href="/messages" label="Messaggi" badge={msgUnread}>
                      <MessageCircle size={20} strokeWidth={2} />
                    </IconButton>
                    <IconButton href="/notifications" label="Notifiche" badge={notifCount}>
                      <Bell size={20} strokeWidth={2} />
                    </IconButton>
                    {role === 'buyer' && (
                      <CartButton count={cartCount} />
                    )}
                    {isSeller && (
                      <Link href="/seller/orders" className="ml-1 inline-flex items-center gap-1.5 bg-white/10 hover:bg-white/20 px-3 py-2 rounded-full text-sm font-semibold">
                        <Package size={16} strokeWidth={2.2} />
                        Ordini
                      </Link>
                    )}
                    {isRider && (
                      <Link href="/rider" className="ml-1 inline-flex items-center gap-1.5 bg-white/10 hover:bg-white/20 px-3 py-2 rounded-full text-sm font-semibold">
                        <Bike size={16} strokeWidth={2.2} />
                        Consegne
                      </Link>
                    )}
                    {isAdmin && (
                      <Link href="/admin" className="ml-1 inline-flex items-center gap-1.5 bg-white/10 hover:bg-white/20 px-3 py-2 rounded-full text-sm font-semibold">
                        <Shield size={16} strokeWidth={2.2} />
                        Admin
                      </Link>
                    )}
                    <UserMenu
                      displayName={displayName}
                      role={role}
                      profileHref={profileHref}
                      isSeller={isSeller}
                      isRider={isRider}
                      isAdmin={isAdmin}
                      onSignOut={handleSignOut}
                    />
                  </>
                )}
              </nav>
            </div>
          </div>
        </div>

        {/* MOBILE */}
        <div className="md:hidden">
          <div className="container mx-auto px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <Link href="/" className="text-xl font-serif font-bold whitespace-nowrap leading-none">
                <span className="text-accent-300">My</span>City
              </Link>
              <LocationPill compact />
              {isAuthenticated && role === 'buyer' && (
                <Link href="/cart" aria-label="Carrello" className="relative ml-auto p-2">
                  <ShoppingCart size={22} strokeWidth={2} />
                  {cartCount > 0 && (
                    <span className="absolute top-0 right-0 bg-accent-500 text-ink-900 text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center">
                      {cartCount > 99 ? '99+' : cartCount}
                    </span>
                  )}
                </Link>
              )}
              {!isAuthenticated && !isLoading && (
                <Link href="/sign-in" className="ml-auto text-sm font-medium hover:text-accent-300">Accedi</Link>
              )}
            </div>
            <div className="mt-2">
              <SearchBar placeholder="Cerca a Piacenza..." />
            </div>
          </div>
        </div>

        {/* SUB — CategoryBar sticky, no auto-hide */}
        {showCategoryBar && (
          <div className="border-t border-primary-600/40 bg-primary-700">
            <CategoryBar />
          </div>
        )}
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------

const IconButton = ({ href, label, badge, children }: { href: string; label: string; badge?: number; children: React.ReactNode }) => (
  <Link
    href={href}
    title={label}
    className="relative p-2 hover:bg-white/10 rounded-full transition-colors"
  >
    {children}
    {badge && badge > 0 ? (
      <span className="absolute -top-0.5 -right-0.5 bg-accent-500 text-ink-900 text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center">
        {badge > 99 ? '99+' : badge}
      </span>
    ) : null}
  </Link>
);

const CartButton = ({ count }: { count: number }) => (
  <Link
    href="/cart"
    title="Carrello"
    className="ml-1 inline-flex items-center gap-1.5 bg-accent-500 hover:bg-accent-600 text-ink-900 px-3 py-2 rounded-full text-sm font-bold transition-colors relative"
  >
    <ShoppingCart size={16} strokeWidth={2.4} />
    <span className="hidden lg:inline">Carrello</span>
    {count > 0 && (
      <span className="bg-ink-900 text-accent-500 text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center">
        {count > 99 ? '99+' : count}
      </span>
    )}
  </Link>
);

const UserMenu = ({ displayName, role, profileHref, isSeller, isRider, isAdmin, onSignOut }: {
  displayName: string;
  role: Role;
  profileHref: string;
  isSeller: boolean;
  isRider: boolean;
  isAdmin: boolean;
  onSignOut: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const initial = displayName?.[0]?.toUpperCase() ?? '?';

  return (
    <div ref={ref} className="relative ml-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 hover:bg-white/10 px-2 py-1.5 rounded-full transition-colors"
        aria-label="Menu account"
      >
        <span className={`w-9 h-9 rounded-full ring-2 ring-white/20 flex items-center justify-center text-sm font-bold uppercase ${
          isSeller ? 'bg-accent-500 text-ink-900' :
          isRider  ? 'bg-olive-500 text-white' :
          isAdmin  ? 'bg-secondary-500 text-white' :
                     'bg-cream-200 text-primary-700'
        }`}>
          {isSeller ? <Store size={16} /> : isRider ? <Bike size={16} /> : initial}
        </span>
        <span className="hidden xl:flex flex-col leading-tight text-left">
          <span className="text-[10px] uppercase tracking-wide opacity-70">
            {isSeller ? 'Negozio' : isRider ? 'Rider' : isAdmin ? 'Admin' : 'Ciao'}
          </span>
          <span className="font-semibold text-sm truncate max-w-[120px]">{displayName}</span>
        </span>
        <ChevronDown size={14} strokeWidth={2.4} className="opacity-70 hidden xl:block" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-xl shadow-warm-lg ring-1 ring-ink-100 overflow-hidden z-50">
          <div className="px-4 py-3 border-b border-ink-100 bg-cream-100">
            <p className="text-xs text-ink-500 uppercase tracking-wide">Ciao</p>
            <p className="font-semibold text-ink-900 truncate">{displayName}</p>
          </div>
          <ul className="py-1 text-ink-700">
            <MenuLink href={profileHref} icon={User} label="Il mio profilo" />
            {role === 'buyer' && (
              <>
                <MenuLink href="/orders" icon={Package} label="I miei ordini" />
                <MenuLink href="/favorites" icon={Heart} label="Preferiti" />
                <MenuLink href="/profile/addresses" icon={MapPin} label="Indirizzi" />
                <MenuLink href="/profile/loyalty" icon={Sparkles} label="Punti & Livello" />
                <MenuLink href="/profile/achievements" icon={Award} label="Badge" />
                <MenuLink href="/profile/gift-cards" icon={Gift} label="Gift Card" />
                <MenuLink href="/lists" icon={ListChecks} label="Liste curate" />
                <MenuLink href="/profile/referral" icon={Megaphone} label="Invita amici · €5" />
              </>
            )}
            {isSeller && (
              <>
                <MenuLink href="/seller/dashboard" icon={LayoutDashboard} label="Dashboard" />
                <MenuLink href="/seller/analytics" icon={TrendingUp} label="Analytics" />
                <MenuLink href="/seller/products" icon={Package} label="I miei prodotti" />
                <MenuLink href="/seller/orders" icon={ShoppingCart} label="Ordini ricevuti" />
                <MenuLink href="/seller/promotions" icon={Sparkles} label="Promozioni" />
                <MenuLink href="/seller/stories" icon={Camera} label="Storie" />
                <MenuLink href="/seller/earnings" icon={Euro} label="Guadagni" />
              </>
            )}
            {isRider && (
              <>
                <MenuLink href="/rider" icon={Bike} label="Dashboard" />
                <MenuLink href="/rider/availability" icon={CircleDot} label="Disponibilità" />
                <MenuLink href="/rider/earnings" icon={Euro} label="Guadagni" />
              </>
            )}
            <MenuLink href="/profile/settings" icon={Settings} label="Impostazioni" />
            <MenuLink href="/faq" icon={HelpCircle} label="FAQ" />
            <li><div className="border-t border-ink-100 my-1" /></li>
            <li>
              <button
                type="button"
                onClick={onSignOut}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-secondary-600 hover:bg-secondary-50 font-medium"
              >
                <LogOut size={16} strokeWidth={2.2} />
                Esci
              </button>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
};

const MenuLink = ({ href, icon: Icon, label }: { href: string; icon: typeof Bell; label: string }) => (
  <li>
    <Link href={href} className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-cream-100">
      <Icon size={16} strokeWidth={2.2} className="text-ink-500 shrink-0" aria-hidden />
      <span className="font-medium">{label}</span>
    </Link>
  </li>
);
