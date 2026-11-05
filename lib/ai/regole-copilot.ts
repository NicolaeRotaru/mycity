import { BANDA_PREZZO_AI } from '@/lib/products/aiPatch';

/**
 * S10 (5/11/2026) — Le regole che il Copilot e la chat del catalogo devono
 * conoscere PRIMA di proporre, non scoprire dopo «Applica».
 */

/**
 * Oltre il 30% il server non applica il prezzo proposto dall'AI
 * (`BANDA_PREZZO_AI`): la proposta si mostrava lo stesso, e il negoziante lo
 * scopriva solo dopo «Applica».
 */
export const REGOLA_PREZZO_AI = `Un prezzo si può cambiare da qui al massimo del ${Math.round(
  BANDA_PREZZO_AI * 100,
)}% in più o in meno rispetto al prezzo attuale. Oltre, NON proporlo: spiega al venditore che quel prezzo va cambiato a mano dal modulo del prodotto.`;

/** Il tetto della risposta del Copilot, in proporzione ai prodotti che vede (circa 60 token l'uno). */
export function tettoTokenCopilot(prodotti: number): number {
  return Math.min(16_000, 1024 + 60 * Math.max(0, prodotti));
}
