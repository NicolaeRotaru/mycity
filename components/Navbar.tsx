'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import {
  Bell, MessageCircle, ShoppingCart, Heart, Bike, Shield, Store, LogOut,
  Package, ChevronDown,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useProfile } from './hooks/useProfile';
import { useCartCount } from './hooks/useCartCount';
import { useNotificationsCount } from './hooks/useNotificationsCount';
import { useMessagesUnread } from './hooks/useMessagesUnread';
import { useFavorites } from './hooks/useFavorites';
import { useBranding } from './hooks/useBranding';
import LocationPill from './LocationPill';
import PromoTicker from './PromoTicker';
import SearchBar from './SearchBar';
import CategoryBar from './CategoryBar';
import { getAccountMenuItems } from '@/lib/account-menu';
import { useShoppingMode, useCanPurchase } from './hooks/useShoppingMode';
import { trackSignedOut } from '@/lib/analytics/events';

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
  const shoppingMode = useShoppingMode(isSeller);
  const canPurchase = useCanPurchase(isAdmin, isSeller, shoppingMode);
  const cartCount = useCartCount();
  const notifCount = useNotificationsCount();
  const msgUnread = useMessagesUnread();
  const { favorites } = useFavorites();
  const favCount = favorites.size;
  const branding = useBranding();

  // Header: sticky su desktop (resta in cima allo scroll, come nel mockup
  // buyer), statico su mobile dove la navigazione persistente è affidata alla
  // MobileTabBar in fondo.

  const handleSignOut = async () => {
    trackSignedOut();
    await supabase.auth.signOut();
    router.push('/sign-in');
    router.refresh();
  };

  // Su /admin, /seller e /rider la navbar globale è nascosta: queste aree usano
  // il proprio shell dedicato (AdminSidebar / SellerShell / RiderShell con la
  // sua bottom tab bar).
  if (pathname?.startsWith('/sign-in') || pathname?.startsWith('/sign-up') || pathname?.startsWith('/admin') || pathname?.startsWith('/seller') || pathname?.startsWith('/rider')) return null;

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

  // CategoryBar = aiuto alla navigazione del marketplace: mostrata in tutte le
  // aree pubbliche (anche ad admin/seller/rider che stanno sfogliando il
  // marketplace), nascosta solo nelle aree "mestiere" (/seller, /rider, /admin).
  const isProArea =
    !!pathname?.startsWith('/seller') ||
    !!pathname?.startsWith('/rider') ||
    !!pathname?.startsWith('/admin');
  const showCategoryBar = !isProArea;

  return (
    <header className="relative md:sticky md:top-0 z-sticky shadow-warm-sm">
      <PromoTicker />

      {/* MAIN — bg primary (terracotta), accenti accent (mustard) */}
      <div className="bg-primary-700 text-white">
        {/* DESKTOP */}
        <div className="hidden md:block">
          <div className="container mx-auto px-4 py-3">
            <div className="flex items-center gap-4">
              <Link href="/" className="text-2xl font-serif font-bold tracking-tight whitespace-nowrap leading-none">
                <span className="text-accent-300">{branding.wordmark.accent}</span>{branding.wordmark.rest}
              </Link>
              <LocationPill />
              <div className="flex-1 max-w-2xl">
                <SearchBar />
              </div>

              <nav className="ml-auto flex items-center gap-2 text-sm">
                {!isAuthenticated && !isLoading && (
                  <>
                    {/* Carrello raggiungibile anche dagli ospiti: il badge usa
                        useCartCount() (storage locale), funziona senza login. */}
                    <CartButton count={cartCount} />
                    <Link href="/sign-in" className="px-3 py-2 hover:text-accent-300 font-medium focus-visible:outline-white">Accedi</Link>
                    <Link href="/sign-up" className="bg-accent-500 hover:bg-accent-600 text-ink-900 px-4 py-2 rounded-full font-semibold transition-colors focus-visible:outline-white">
                      Registrati
                    </Link>
                  </>
                )}

                {isAuthenticated && (
                  <>
                    {(role === 'buyer' || (isSeller && shoppingMode)) && (
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
                    {canPurchase && (
                      <CartButton count={cartCount} />
                    )}
                    {isSeller && (
                      <Link href="/seller/orders" className="ml-1 inline-flex items-center gap-1.5 bg-white/10 hover:bg-white/20 px-3 py-2 rounded-full text-sm font-semibold focus-visible:outline-white">
                        <Package size={16} strokeWidth={2.2} />
                        Ordini
                      </Link>
                    )}
                    {isRider && (
                      <Link href="/rider" className="ml-1 inline-flex items-center gap-1.5 bg-white/10 hover:bg-white/20 px-3 py-2 rounded-full text-sm font-semibold focus-visible:outline-white">
                        <Bike size={16} strokeWidth={2.2} />
                        Consegne
                      </Link>
                    )}
                    {isAdmin && (
                      <Link href="/admin" className="ml-1 inline-flex items-center gap-1.5 bg-white/10 hover:bg-white/20 px-3 py-2 rounded-full text-sm font-semibold focus-visible:outline-white">
                        <Shield size={16} strokeWidth={2.2} />
                        Admin
                      </Link>
                    )}
                    <UserMenu
                      displayName={displayName}
                      storeLogo={profile?.store_logo ?? null}
                      role={role}
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
            <div className="flex items-center gap-2">
              <Link href="/" className="shrink-0 text-xl font-serif font-bold whitespace-nowrap leading-none">
                <span className="text-accent-300">{branding.wordmark.accent}</span>{branding.wordmark.rest}
              </Link>
              <div className="min-w-0 flex-1 flex justify-center">
                <LocationPill compact />
              </div>
              {isAuthenticated && canPurchase && (
                <Link href="/cart" aria-label="Carrello" className="relative shrink-0 inline-flex p-2 text-white">
                  <ShoppingCart size={22} strokeWidth={2} aria-hidden />
                  {cartCount > 0 && (
                    <span className="pointer-events-none absolute -top-0.5 -right-0.5 bg-accent-500 text-ink-900 text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center leading-none">
                      {cartCount > 99 ? '99+' : cartCount}
                    </span>
                  )}
                </Link>
              )}
              {!isAuthenticated && !isLoading && (
                <>
                  {cartCount > 0 ? (
                    <Link href="/cart" aria-label="Carrello" className="relative shrink-0 inline-flex p-2 text-white">
                      <ShoppingCart size={22} strokeWidth={2} aria-hidden />
                      <span className="pointer-events-none absolute -top-0.5 -right-0.5 bg-accent-500 text-ink-900 text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center leading-none">
                        {cartCount > 99 ? '99+' : cartCount}
                      </span>
                    </Link>
                  ) : (
                    <Link href="/sign-in" className="shrink-0 text-sm font-medium hover:text-accent-300 focus-visible:outline-white">Accedi</Link>
                  )}
                </>
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
    aria-label={label}
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
    aria-label="Carrello"
    className="ml-1 inline-flex items-center gap-1.5 bg-accent-500 hover:bg-accent-600 text-ink-900 px-3 py-2 rounded-full text-sm font-bold transition-colors relative"
  >
    <ShoppingCart size={16} strokeWidth={2.4} />
    <span className="hidden lg:inline">Carrello</span>
    {count > 0 && (
      <span className="bg-ink-900 text-accent-400 text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center">
        {count > 99 ? '99+' : count}
      </span>
    )}
  </Link>
);

const UserMenu = ({ displayName, storeLogo, role, isSeller, isRider, isAdmin, onSignOut }: {
  displayName: string;
  storeLogo?: string | null;
  role: Role;
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
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {isSeller && storeLogo ? (
          <span className="w-9 h-9 rounded-full ring-2 ring-white/20 overflow-hidden bg-white relative shrink-0">
            <Image src={storeLogo} alt={displayName} fill sizes="36px" className="object-cover" />
          </span>
        ) : (
          <span className={`w-9 h-9 rounded-full ring-2 ring-white/20 flex items-center justify-center text-sm font-bold uppercase ${
            isSeller ? 'bg-accent-500 text-ink-900' :
            isRider  ? 'bg-olive-500 text-white' :
            isAdmin  ? 'bg-secondary-500 text-white' :
                       'bg-cream-200 text-primary-700'
          }`}>
            {isSeller ? <Store size={16} /> : isRider ? <Bike size={16} /> : initial}
          </span>
        )}
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
          <div className="px-4 py-3 border-b border-ink-100 bg-cream-100 flex items-center gap-3">
            {isSeller && storeLogo ? (
              <span className="w-11 h-11 rounded-full overflow-hidden bg-white ring-1 ring-ink-100 relative shrink-0">
                <Image src={storeLogo} alt={displayName} fill sizes="44px" className="object-cover" />
              </span>
            ) : (
              <span className={`w-11 h-11 rounded-full flex items-center justify-center text-base font-bold uppercase shrink-0 ${
                isSeller ? 'bg-accent-500 text-ink-900' :
                isRider  ? 'bg-olive-500 text-white' :
                isAdmin  ? 'bg-secondary-500 text-white' :
                           'bg-primary-100 text-primary-700'
              }`}>
                {isSeller ? <Store size={20} /> : isRider ? <Bike size={20} /> : (displayName?.[0]?.toUpperCase() ?? '?')}
              </span>
            )}
            <div className="min-w-0">
              <p className="text-xs text-ink-500 uppercase tracking-wide">
                {isSeller ? 'Negozio' : isRider ? 'Rider' : isAdmin ? 'Admin' : 'Ciao'}
              </p>
              <p className="font-semibold text-ink-900 truncate">{displayName}</p>
            </div>
          </div>
          <ul role="menu" className="py-1 text-ink-700">
            {getAccountMenuItems(role).map((it) => (
              <MenuLink key={it.href} href={it.href} icon={it.icon} label={it.label} />
            ))}
            <li role="separator"><div className="border-t border-ink-100 my-1" /></li>
            <li role="none">
              <button
                type="button"
                role="menuitem"
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
  <li role="none">
    <Link href={href} role="menuitem" className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-cream-100">
      <Icon size={16} strokeWidth={2.2} className="text-ink-500 shrink-0" aria-hidden />
      <span className="font-medium">{label}</span>
    </Link>
  </li>
);
