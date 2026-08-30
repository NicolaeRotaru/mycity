import { Home, Search, MessageCircle, ShoppingCart, User, Package, Bike, Shield, Plus, Eye, type LucideIcon } from 'lucide-react';

/**
 * QUALI SCHEDE STANNO IN FONDO ALLO SCHERMO, E QUANDO SERVE IL PULSANTE «TU».
 *
 * 30/8/2026 (R097) — AL VENDITORE CHE COMPRA COMPARIVANO DUE PORTE PER LO
 * STESSO PANNELLO.
 *
 * Il pulsante tondo «Tu» che galleggia in basso a destra si disegnava sulla
 * sola condizione «è un venditore o un amministratore». Ma quando il venditore
 * passa in modalità acquisto le sue schede diventano quelle di un cliente
 * qualunque — e quelle una porta all'account ce l'hanno già. Risultato: due
 * porte per lo stesso pannello, e un cerchio grigio sospeso a metà del bordo
 * destro (`bottom-44`, cioè ben sopra la barra) che copre prezzo e pulsante «+»
 * di una scheda prodotto su schermi stretti. Chi lo vede non capisce cosa sia.
 *
 * La regola giusta non è un elenco di ruoli, è una domanda sui dati: il
 * pulsante serve **solo se fra le schede non c'è già una porta all'account**.
 * Scritta così non può più andare fuori sincrono con l'elenco delle schede.
 *
 * E l'elenco vive qui, fuori dal componente, perché in questa repo un
 * componente React non si può montare in una prova: finché la decisione stava
 * dentro il JSX, nessuna prova poteva accorgersi del doppione.
 */

export type Scheda = {
  href: string;
  icon: LucideIcon;
  label: string;
  badge?: number;
  /** Di che cosa parla il numero della pallina: «non letti», «articoli». */
  badgeUnita?: string;
  isAccount?: boolean;
  isSupport?: boolean;
  exact?: boolean;
};

export type ChiGuarda = {
  isAuthenticated: boolean;
  isSeller: boolean;
  isRider: boolean;
  isAdmin: boolean;
  /** Il venditore ha premuto «vai a fare la spesa»: qui è un cliente. */
  sellerShopping: boolean;
};

export type ContiInFondo = {
  /** Articoli nel carrello. */
  carrello?: number;
  /** Messaggi non letti. */
  messaggi?: number;
};

/** Le etichette, tradotte da chi chiama (next-intl vive nel componente). */
export type Etichette = (chiave: string) => string;

export function schedeInFondo(chi: ChiGuarda, t: Etichette, conti: ContiInFondo = {}): Scheda[] {
  const carrello = conti.carrello;
  const messaggi = conti.messaggi;

  if (chi.isAdmin) {
    return [
      { href: '/admin',          icon: Shield,        label: t('admin'), exact: true },
      { href: '/admin/users',    icon: User,          label: t('users') },
      { href: '/admin/orders',   icon: Package,       label: t('orders') },
      { href: '/messages',       icon: MessageCircle, label: t('messages'), badge: messaggi },
      { href: '/admin/activity', icon: Eye,           label: t('surveillance') },
    ];
  }
  if (chi.isSeller && !chi.sellerShopping) {
    return [
      { href: '/seller/dashboard',    icon: Home,          label: t('home'), exact: true },
      { href: '/seller/products',     icon: Package,       label: t('products') },
      { href: '/seller/products/new', icon: Plus,          label: t('addProduct') },
      { href: '/messages',            icon: MessageCircle, label: t('messages'), badge: messaggi },
      { href: '/seller/orders',       icon: ShoppingCart,  label: t('orders') },
    ];
  }
  if (chi.isRider) {
    return [
      { href: '/rider',              icon: ShoppingCart,  label: t('orders'), exact: true },
      { href: '/rider/history',      icon: Package,       label: t('history') },
      { href: '/rider/availability', icon: Bike,          label: t('availability') },
      { href: '/messages',           icon: MessageCircle, label: t('messages'), badge: messaggi },
      { href: '/rider/profile',      icon: User,          label: t('me'), isAccount: true },
    ];
  }
  if (chi.isAuthenticated) {
    return [
      { href: '/',        icon: Home,         label: t('home') },
      { href: '/search',  icon: Search,       label: t('search') },
      { href: '/cart',    icon: ShoppingCart, label: t('cart'), badge: carrello, badgeUnita: 'articoli' },
      { href: '/orders',  icon: Package,      label: t('orders') },
      { href: '/profile', icon: User,         label: t('me'), isAccount: true },
    ];
  }
  return [
    { href: '/',        icon: Home,         label: t('home') },
    { href: '/search',  icon: Search,       label: t('search') },
    { href: '/stores',  icon: Package,      label: t('stores') },
    { href: '/cart',    icon: ShoppingCart, label: t('cart'), badge: carrello, badgeUnita: 'articoli' },
    { href: '/sign-in', icon: User,         label: t('signIn') },
  ];
}

/**
 * Il pulsante flottante «Tu» serve solo dove la barra non ha già la sua porta
 * all'account. Domanda sui dati, non elenco di ruoli: è così che il doppione
 * non può tornare.
 */
export function serveIlPulsanteAccount(schede: readonly Scheda[]): boolean {
  return !schede.some((s) => s.isAccount);
}
