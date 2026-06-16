// lib/products/economics.ts
import { MARKETPLACE_FEE_BPS, PLATFORM_DELIVERY_FEE_CENTS } from '@/lib/constants';

/**
 * Economia del venditore su un prezzo di vendita: quanto incassa davvero dopo
 * la commissione marketplace. Sorgente unica e client-safe (niente Stripe) così
 * la stessa matematica alimenta sia il contesto del motore AI "Migliora tutto"
 * (per proporre un prezzo consapevole del margine) sia la UI che la mostra al
 * venditore — senza divergenze tra i due.
 *
 * Nota: la commissione (MARKETPLACE_FEE_BPS) la trattiene MyCity sull'incassato
 * del venditore. La fee di consegna (PLATFORM_DELIVERY_FEE_CENTS) la paga
 * l'acquirente sopra il prezzo del prodotto e NON intacca il netto venditore:
 * la riportiamo solo come contesto sul prezzo finale a carrello.
 */

/** Commissione come frazione (es. 0.10 per 1000 bps). */
export const MARKETPLACE_FEE_RATE = MARKETPLACE_FEE_BPS / 10_000;

/** Fee di consegna piattaforma in euro (a carico dell'acquirente, consegna a domicilio). */
export const PLATFORM_DELIVERY_FEE_EUR = PLATFORM_DELIVERY_FEE_CENTS / 100;

export type SellerEconomics = {
  /** Prezzo di vendita del prodotto (euro). */
  price: number;
  /** Commissione marketplace trattenuta (euro). */
  commission: number;
  /** Quanto incassa il venditore dopo la commissione (euro). */
  netToSeller: number;
  /** Aliquota commissione applicata (frazione). */
  feeRate: number;
  /** Fee di consegna a domicilio pagata dall'acquirente (euro). */
  deliveryFee: number;
};

/** Arrotonda a 2 decimali in modo stabile (evita 0.1+0.2 e simili). */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Scompone un prezzo di vendita nelle sue componenti economiche per il
 * venditore. Prezzi non validi (≤0, NaN) tornano a zero su tutte le voci.
 */
export function sellerEconomics(price: number | null | undefined): SellerEconomics {
  const p = typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : 0;
  const commission = round2(p * MARKETPLACE_FEE_RATE);
  return {
    price: round2(p),
    commission,
    netToSeller: round2(p - commission),
    feeRate: MARKETPLACE_FEE_RATE,
    deliveryFee: PLATFORM_DELIVERY_FEE_EUR,
  };
}

/** Netto venditore per un dato prezzo (scorciatoia). */
export function netToSeller(price: number | null | undefined): number {
  return sellerEconomics(price).netToSeller;
}
