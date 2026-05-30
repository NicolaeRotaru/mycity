import { FREE_SHIPPING_THRESHOLD, SHIPPING_PER_ORDER } from './constants';
import { haversineKm, riderFee } from './geo';

/**
 * Calcolo spedizione per un gruppo (un venditore). FONTE UNICA condivisa tra
 * client (checkout UI) e server (/api/stripe/checkout, /api/orders/cod) così
 * che l'importo mostrato all'utente coincida sempre con quello addebitato.
 *
 * Regole (identiche alla UI originale):
 *  - ritiro in negozio o coupon FREE_SHIPPING → 0
 *  - subtotale ≥ soglia spedizione gratuita → 0
 *  - coordinate negozio+consegna note → tariffa distanza (riderFee)
 *  - altrimenti → tariffa flat di fallback
 *
 * SICUREZZA: il server passa SEMPRE il subtotale e le coordinate ricalcolati
 * dal DB, mai valori provenienti dal client.
 */
export function shippingForEuro(opts: {
  subtotal: number;
  storeLat: number | null;
  storeLng: number | null;
  deliveryLat: number | null;
  deliveryLng: number | null;
  pickupInStore: boolean;
  freeShipping?: boolean;
}): number {
  const { subtotal, storeLat, storeLng, deliveryLat, deliveryLng, pickupInStore, freeShipping } = opts;
  if (pickupInStore || freeShipping) return 0;
  if (subtotal >= FREE_SHIPPING_THRESHOLD) return 0;
  if (storeLat && storeLng && deliveryLat && deliveryLng) {
    return riderFee(haversineKm(storeLat, storeLng, deliveryLat, deliveryLng));
  }
  return SHIPPING_PER_ORDER;
}

/** Come shippingForEuro ma restituisce centesimi interi. */
export function shippingCentsFor(opts: Parameters<typeof shippingForEuro>[0]): number {
  return Math.round(shippingForEuro(opts) * 100);
}
