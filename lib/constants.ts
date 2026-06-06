export const FREE_SHIPPING_THRESHOLD = 30;
export const LOW_STOCK_THRESHOLD = 5;
export const NEW_PRODUCT_DAYS = 14;

/** Spedizione flat di fallback quando le coordinate non sono note (€). */
export const SHIPPING_PER_ORDER = 4.9;
/** Sconto percentuale per ritiro in negozio. */
export const PICKUP_DISCOUNT_PERCENT = 10;

// Riferimenti per icone (nomi lucide-react). Componenti li importano e
// renderizzano per evitare di sparare emoji nelle UI strutturali.
export const VALUE_PROPS = [
  { icon: 'Truck',      title: 'Spedizione gratuita',      subtitle: `sopra €${FREE_SHIPPING_THRESHOLD}` },
  { icon: 'BanknoteArrowUp', title: 'Pagamento alla consegna', subtitle: 'in contanti, zero rischi' },
  { icon: 'Store',      title: '100% locale',              subtitle: 'venditori della tua città' },
  { icon: 'Zap',        title: 'Consegna rapida',          subtitle: 'oggi se disponibile, altrimenti 24-48h' },
] as const;
