/**
 * Idoneità alla consegna Express — modello "Entrambi":
 *  - per negozio: profiles.offers_express (default per i suoi prodotti);
 *  - per prodotto: products.express_enabled (NULL = eredita, true/false = override).
 */

export type ExpressMode = 'inherit' | 'yes' | 'no';

/** products.express_enabled (bool|null) → modalità UI a 3 stati. */
export function expressEnabledToMode(v: boolean | null | undefined): ExpressMode {
  if (v === true) return 'yes';
  if (v === false) return 'no';
  return 'inherit';
}

/** Modalità UI → products.express_enabled (bool|null). */
export function modeToExpressEnabled(m: ExpressMode): boolean | null {
  if (m === 'yes') return true;
  if (m === 'no') return false;
  return null;
}

/**
 * Un prodotto è idoneo Express se ha override true, oppure eredita (NULL) e il
 * negozio offre Express. Override false esclude sempre.
 */
export function isExpressEligible(
  productExpressEnabled: boolean | null | undefined,
  sellerOffersExpress: boolean | null | undefined,
): boolean {
  if (productExpressEnabled === true) return true;
  if (productExpressEnabled === false) return false;
  return Boolean(sellerOffersExpress);
}
