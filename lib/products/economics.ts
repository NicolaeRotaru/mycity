// lib/products/economics.ts
import { MARKETPLACE_FEE_BPS, PLATFORM_DELIVERY_FEE_CENTS } from '@/lib/constants';
import { tariffaConsegnaCents } from '@/lib/ordini/prezzi';

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
  /**
   * Consegna di un carrello che contiene SOLO un pezzo di questo prodotto (euro).
   * Non è la consegna «del prodotto»: si paga sul carrello intero (tre pagnotte da
   * 3,50 € pagano 3 €, non 3 × 4 €). 0 se il prezzo non è valido, come le altre voci.
   */
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
    // 29/10/2026 — la consegna con la fascia per questa spesa: 4 € sotto i 10 €, 3 € da 10 € in su.
    // 2282 — Con un prezzo non valido la consegna è 0 come tutto il resto (prima usciva 4 €).
    deliveryFee: p > 0
      ? tariffaConsegnaCents({ pickupInStore: false, merceCents: Math.round(p * 100), consegnaVeloce: false }) / 100
      : 0,
  };
}

/** Netto venditore per un dato prezzo (scorciatoia). */
export function netToSeller(price: number | null | undefined): number {
  return sellerEconomics(price).netToSeller;
}

/**
 * 12/11/2026 (R04-021) — LA CONSEGNA SI DICE ALL'AI COME REGOLA DEL CARRELLO.
 *
 * Al modello di «Migliora» arrivava `deliveryFee` del singolo prodotto: per
 * una pagnotta da 3,50 € «consegna 4 €», per un prodotto senza prezzo «0 €».
 * Ma la consegna si paga sul carrello intero (tre pagnotte pagano 3 €). Qui la
 * regola, con le cifre prese dalla stessa tariffa del carrello.
 */
export function regolaConsegnaPerAi(): string {
  const sotto = tariffaConsegnaCents({ pickupInStore: false, merceCents: 999, consegnaVeloce: false }) / 100;
  const sopra = tariffaConsegnaCents({ pickupInStore: false, merceCents: 1000, consegnaVeloce: false }) / 100;
  return (
    `la consegna a domicilio si paga sul CARRELLO intero, non sul singolo prodotto: ` +
    `€${sopra.toFixed(2)} per una spesa da 10 € in su in questo negozio, €${sotto.toFixed(2)} sotto i 10 €; ` +
    `la paga l'acquirente e non incide sul netto venditore`
  );
}
