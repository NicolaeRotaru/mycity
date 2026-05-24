export const FREE_SHIPPING_THRESHOLD = 30;
export const LOW_STOCK_THRESHOLD = 5;
export const NEW_PRODUCT_DAYS = 14;

// Riferimenti per icone (nomi lucide-react). Componenti li importano e
// renderizzano per evitare di sparare emoji nelle UI strutturali.
export const VALUE_PROPS = [
  { icon: 'Truck',      title: 'Spedizione gratuita',      subtitle: `sopra €${FREE_SHIPPING_THRESHOLD}` },
  { icon: 'BanknoteArrowUp', title: 'Pagamento alla consegna', subtitle: 'in contanti, zero rischi' },
  { icon: 'Store',      title: '100% locale',              subtitle: 'venditori della tua città' },
  { icon: 'Zap',        title: 'Consegna rapida',          subtitle: 'entro 24-48h' },
] as const;
