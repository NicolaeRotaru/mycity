/**
 * Regole di accesso al marketplace per ruolo.
 *
 * - Admin: può sfogliare (supporto/QA) ma NON acquistare.
 * - Seller: accede al marketplace solo in "modalità acquisto" (cookie impostato
 *   dal pulsante "Vai al marketplace" in SellerShell, ?shop=1).
 * - Buyer: accesso libero.
 */

export const SHOPPING_MODE_COOKIE = 'mycity_shopping_mode';
export const SHOPPING_MODE_QUERY = 'shop';
export const EXIT_SHOPPING_QUERY = 'exit_shop';
/** Durata sessione acquisto venditore (8h). */
export const SHOPPING_MODE_MAX_AGE = 8 * 60 * 60;

/**
 * 6/9/2026 — LE VETRINE SORVEGLIATE NON ERANO LE VETRINE VERE.
 *
 * Qui dentro c'è l'elenco delle pagine su cui il venditore senza «modalità
 * acquisto» viene rimandato alla sua dashboard. Mancavano proprio le sette
 * destinazioni della barra sotto l'header (Tutti i negozi, Promozioni, Novità,
 * Regali, Vicino a te, Più venduti, Piccoli prezzi) e la pagina /categorie:
 * il negoziante col permesso scaduto apriva «Novità», vedeva i prodotti,
 * toccava una scheda e si ritrovava sulla dashboard senza una spiegazione.
 * C'erano invece /collections e /daily-drops, che non sono mai esistite come
 * pagine.
 *
 * L'elenco resta scritto a mano — importarlo da CategoryBar trascinerebbe nel
 * middleware un componente client con lucide-react e il client Supabase — ma
 * ora c'è una prova che lo confronta con la barra vera e con le pagine vere:
 * tests/unit/le-vetrine-sorvegliate-sono-le-vetrine-vere.test.ts.
 */
const MARKETPLACE_BROWSE_PREFIXES = [
  '/product',
  '/store',
  '/cart',
  '/checkout',
  '/search',
  '/category',
  // Le sette destinazioni della barra categorie + l'indice delle categorie.
  '/stores',
  '/promozioni',
  '/novita',
  '/regali',
  '/near',
  '/piu-venduti',
  '/piccoli-prezzi',
  '/categorie',
  // Altre vetrine del catalogo.
  '/lists',
  '/shop-of-month',
  '/events',
  '/shared-cart',
  '/favorites',
];

/** Rotte marketplace pubbliche (catalogo/acquisto), escluse aree mestiere. */
export function isMarketplaceBrowsePath(pathname: string): boolean {
  if (pathname === '/') return true;
  return MARKETPLACE_BROWSE_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export type ProfileRole = 'buyer' | 'seller' | 'rider' | 'admin';

/** Ruoli che possono completare un ordine (server-side). */
export function canRolePurchase(role: ProfileRole | string | undefined): boolean {
  return role === 'buyer' || role === 'seller';
}

/** Seller può vedere il catalogo solo con cookie modalità acquisto attivo. */
export function sellerMayBrowseMarketplace(hasShoppingMode: boolean): boolean {
  return hasShoppingMode;
}

/** Messaggio API se il ruolo non può acquistare; null = ok. */
export function purchaseBlockReason(role: ProfileRole | string | undefined): string | null {
  if (role === 'admin') {
    return 'Gli account di assistenza/admin non possono effettuare acquisti sul marketplace.';
  }
  if (!canRolePurchase(role)) {
    return 'Il tuo account non può effettuare acquisti.';
  }
  return null;
}
