export const FREE_SHIPPING_THRESHOLD = 30;
export const LOW_STOCK_THRESHOLD = 5;
export const NEW_PRODUCT_DAYS = 14;

/** Spedizione flat di fallback quando le coordinate non sono note (€). */
export const SHIPPING_PER_ORDER = 4.9;
/** Sconto percentuale per ritiro in negozio. */
export const PICKUP_DISCOUNT_PERCENT = 10;
/**
 * Fee di consegna trattenuta dalla piattaforma (in centesimi) su ogni ordine
 * con consegna a domicilio. NON si applica ai ritiri in negozio. La incassa
 * MyCity: non finisce nel payout del venditore né nel compenso del rider.
 */
export const PLATFORM_DELIVERY_FEE_CENTS = 300;

/**
 * Commissione marketplace in basis point (1000 = 10.00%) trattenuta da MyCity
 * su ogni vendita. Sorgente unica e client-safe: la importano sia il calcolo
 * del payout Stripe (lib/stripe/client → computeApplicationFeeCents) sia
 * l'economia mostrata al venditore (net-to-seller in lib/products/economics).
 * Vive qui — e non in lib/stripe/client (server-only, importa l'SDK Stripe) —
 * così è usabile anche dai componenti client senza trascinare Stripe nel bundle.
 */
export const MARKETPLACE_FEE_BPS = 1000; // 10.00%

// Riferimenti per icone (nomi lucide-react). Componenti li importano e
// renderizzano per evitare di sparare emoji nelle UI strutturali.
export const VALUE_PROPS = [
  { icon: 'Truck',      title: 'Spedizione gratuita',      subtitle: `sopra €${FREE_SHIPPING_THRESHOLD}` },
  { icon: 'BanknoteArrowUp', title: 'Pagamento alla consegna', subtitle: 'in contanti, zero rischi' },
  { icon: 'Store',      title: '100% locale',              subtitle: 'venditori della tua città' },
  { icon: 'Zap',        title: 'Consegna rapida',          subtitle: 'oggi se disponibile, altrimenti 24-48h' },
] as const;
