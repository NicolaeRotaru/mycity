import { COMPENSO_RIDER_CENTS, FREE_SHIPPING_THRESHOLD, SHIPPING_PER_ORDER } from './constants';
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

/**
 * Quanto va pagato al fattorino per questa consegna, in centesimi.
 *
 * È una cosa diversa da `shippingForEuro`, che dice quanto paga il CLIENTE.
 * Le due venivano confuse: il compenso del fattorino si leggeva dal prezzo di
 * spedizione pagato dal cliente, e sopra la soglia della spedizione gratuita
 * quel prezzo è zero. Risultato: su ogni ordine sopra i 30 euro il fattorino
 * consegnava e non veniva pagato.
 *
 * Poi il compenso è stato staccato dal prezzo pagato dal cliente, ma è rimasto
 * legato alla distanza — e il conto continuava a non tornare, perché con la
 * spedizione gratis l'unica cosa disponibile per pagarlo erano i 3 euro di fee
 * di consegna: oltre i 420 metri non bastavano più.
 *
 * Adesso il compenso è FISSO (Nicola, 20/8/2026). La distanza non c'entra più:
 * la fee di consegna che la piattaforma trattiene copre il compenso da sola,
 * su ogni ordine, anche quando il cliente non paga spedizione.
 *
 * Con il ritiro in negozio non c'è consegna, quindi non c'è compenso.
 */
export function compensoRiderCents(opts: {
  pickupInStore: boolean;
}): number {
  return opts.pickupInStore ? 0 : COMPENSO_RIDER_CENTS;
}
