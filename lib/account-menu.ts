import {
  User, Package, Heart, MapPin, Sparkles, Award, Gift, ListChecks, Megaphone,
  LayoutDashboard, TrendingUp, ShoppingCart, Camera, Euro, Bike, CircleDot,
  Settings, HelpCircle, Shield, Home, Users, ShoppingBag, Ticket, Crown,
  Calendar, Coins, AlertTriangle, Headset, Star, Scale, ScrollText, History, type LucideIcon,
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
    // Ordine per retention: prima le leve legate al commercio (loyalty, referral),
    // poi le utilità; la gamification pura (Badge) resta accessibile ma in fondo,
    // così non compete con ciò che fa tornare a comprare.
    items.push(
      { href: '/orders', icon: Package, label: 'I miei ordini' },
      { href: '/favorites', icon: Heart, label: 'Preferiti' },
      { href: '/profile/loyalty', icon: Sparkles, label: 'Punti & Livello' },
      { href: '/profile/referral', icon: Megaphone, label: 'Invita amici · €5' },
      { href: '/profile/addresses', icon: MapPin, label: 'Indirizzi' },
      { href: '/profile/gift-cards', icon: Gift, label: 'Gift Card' },
      { href: '/lists', icon: ListChecks, label: 'Liste curate' },
      { href: '/profile/achievements', icon: Award, label: 'Badge' },
    );
  } else if (role === 'seller') {
    items.push(
      { href: '/seller/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
      { href: '/seller/analytics', icon: TrendingUp, label: 'Analytics' },
      { href: '/seller/products', icon: Package, label: 'I miei prodotti' },
      { href: '/seller/orders', icon: ShoppingCart, label: 'Ordini ricevuti' },
      { href: '/seller/customers', icon: Users, label: 'Clienti' },
      { href: '/seller/promotions', icon: Sparkles, label: 'Promozioni' },
      { href: '/seller/stories', icon: Camera, label: 'Storie' },
      { href: '/seller/earnings', icon: Euro, label: 'Guadagni' },
      { href: '/seller/reviews', icon: Star, label: 'Recensioni' },
    );
  } else if (role === 'rider') {
    items.push(
      { href: '/rider', icon: Bike, label: 'Dashboard' },
      { href: '/rider/availability', icon: CircleDot, label: 'Disponibilità' },
      { href: '/rider/earnings', icon: Euro, label: 'Guadagni' },
      { href: '/rider/history', icon: History, label: 'Storico' },
      { href: '/rider/reviews', icon: Star, label: 'Recensioni' },
    );
  } else if (role === 'admin') {
    // Tutta la navigazione admin vive qui (menu "Tu"); sotto l'icona scudo
    // resta solo la dashboard amministratore.
    items.push(
      { href: '/admin', icon: Shield, label: 'Dashboard admin' },
      { href: '/admin/today', icon: Home, label: 'Today' },
      { href: '/admin/funnel', icon: TrendingUp, label: 'Funnel & Cohort' },
      { href: '/admin/users', icon: Users, label: 'Utenti' },
      { href: '/admin/orders', icon: ShoppingBag, label: 'Ordini' },
      { href: '/admin/disputes', icon: Scale, label: 'Dispute' },
      { href: '/admin/products', icon: Package, label: 'Prodotti' },
      { href: '/admin/support-chat', icon: Headset, label: 'Chat assistenza' },
      { href: '/admin/coupons', icon: Ticket, label: 'Coupon' },
      { href: '/admin/shop-of-month', icon: Crown, label: 'Negozio mese' },
      { href: '/admin/events', icon: Calendar, label: 'Eventi' },
      { href: '/admin/sponsored', icon: Megaphone, label: 'Sponsored' },
      { href: '/admin/cashback', icon: Coins, label: 'Cashback' },
      { href: '/admin/sos', icon: AlertTriangle, label: 'SOS Rider' },
      { href: '/admin/audit', icon: ScrollText, label: 'Audit log' },
    );
  }

  items.push(
    { href: '/profile/settings', icon: Settings, label: 'Impostazioni' },
    { href: '/faq', icon: HelpCircle, label: 'FAQ' },
  );

  return items;
}
