import {
  User, Package, MapPin, Heart, Bell, Sparkles,
  Gift, UserPlus, Settings, Trophy,
  MessageCircle, RotateCcw,
  type LucideIcon,
} from 'lucide-react';

/**
 * LE VOCI DELL'AREA ACCOUNT, IN UN POSTO SOLO — 28/11/2026.
 *
 * Stavano scritte due volte: nella barra laterale del computer (AccountSidebar) e nella striscia di
 * pillole del telefono (AccountShell), con lo stesso elenco copiato a mano. Nicola, dal telefono, ha
 * chiesto di togliere la striscia e farne un menu: ora la barra laterale e il menu del telefono leggono
 * da qui, e una voce nuova si aggiunge una volta sola.
 */

/** Chiave del conto «non letto» agganciato alla voce. */
export type ContoVoce = 'notifications' | 'messages';
export type VoceAccount = { href: string; icon: LucideIcon; label: string; badge?: ContoVoce };
export type GruppoAccount = { group: string; items: VoceAccount[] };

export const VOCI_ACCOUNT: GruppoAccount[] = [
  { group: 'Account', items: [
    { href: '/profile', icon: User, label: 'Profilo' },
    { href: '/orders', icon: Package, label: 'Ordini' },
    { href: '/profile/returns', icon: RotateCcw, label: 'Resi' },
    { href: '/profile/addresses', icon: MapPin, label: 'Indirizzi' },
  ] },
  { group: 'Attività', items: [
    { href: '/favorites', icon: Heart, label: 'Preferiti' },
    { href: '/messages', icon: MessageCircle, label: 'Messaggi', badge: 'messages' },
    { href: '/notifications', icon: Bell, label: 'Notifiche', badge: 'notifications' },
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

/** /profile è acceso solo sulla pagina esatta: le sottopagine hanno la loro voce. */
export function voceAccountAttiva(pathname: string, href: string): boolean {
  if (href === '/profile') return pathname === '/profile';
  return pathname === href || pathname.startsWith(href + '/');
}
