import {
  User, Package, Heart, MapPin, Sparkles, Award, Gift, ListChecks, Megaphone,
  LayoutDashboard, TrendingUp, ShoppingCart, Camera, Euro, Bike, CircleDot,
  Settings, HelpCircle, Shield, type LucideIcon,
} from 'lucide-react';

/**
 * Voci del menu account — fonte unica condivisa tra la tendina desktop
 * (Navbar) e il pannello mobile (MobileAccountSheet), così le due viste
 * mostrano sempre le stesse cose.
 */
export type MenuRole = 'buyer' | 'seller' | 'rider' | 'admin' | null;
export type MenuItem = { href: string; icon: LucideIcon; label: string };

export const profileHrefFor = (role: MenuRole): string =>
  role === 'seller' ? '/seller/profile' : role === 'rider' ? '/rider/profile' : '/profile';

export function getAccountMenuItems(role: MenuRole): MenuItem[] {
  const items: MenuItem[] = [
    { href: profileHrefFor(role), icon: User, label: 'Il mio profilo' },
  ];

  if (role === 'buyer') {
    items.push(
      { href: '/orders', icon: Package, label: 'I miei ordini' },
      { href: '/favorites', icon: Heart, label: 'Preferiti' },
      { href: '/profile/addresses', icon: MapPin, label: 'Indirizzi' },
      { href: '/profile/loyalty', icon: Sparkles, label: 'Punti & Livello' },
      { href: '/profile/achievements', icon: Award, label: 'Badge' },
      { href: '/profile/gift-cards', icon: Gift, label: 'Gift Card' },
      { href: '/lists', icon: ListChecks, label: 'Liste curate' },
      { href: '/profile/referral', icon: Megaphone, label: 'Invita amici · €5' },
    );
  } else if (role === 'seller') {
    items.push(
      { href: '/seller/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
      { href: '/seller/analytics', icon: TrendingUp, label: 'Analytics' },
      { href: '/seller/products', icon: Package, label: 'I miei prodotti' },
      { href: '/seller/orders', icon: ShoppingCart, label: 'Ordini ricevuti' },
      { href: '/seller/promotions', icon: Sparkles, label: 'Promozioni' },
      { href: '/seller/stories', icon: Camera, label: 'Storie' },
      { href: '/seller/earnings', icon: Euro, label: 'Guadagni' },
    );
  } else if (role === 'rider') {
    items.push(
      { href: '/rider', icon: Bike, label: 'Dashboard' },
      { href: '/rider/availability', icon: CircleDot, label: 'Disponibilità' },
      { href: '/rider/earnings', icon: Euro, label: 'Guadagni' },
    );
  } else if (role === 'admin') {
    items.push({ href: '/admin', icon: Shield, label: 'Admin' });
  }

  items.push(
    { href: '/profile/settings', icon: Settings, label: 'Impostazioni' },
    { href: '/faq', icon: HelpCircle, label: 'FAQ' },
  );

  return items;
}
