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

/**
 * R21-002 (13/11/2026) — Il tempo di UN tentativo del Copilot: 80 s, senza ritentativi.
 *
 * Il conto con i 120 s della rotta: il filtro sull'istruzione, nel caso peggiore,
 * ne usa 33 (due tentativi da 16,3 s), poi restano 87 s. Un solo tentativo da
 * 80 s ci sta; due da 60 s no (120,5 s: Vercel spegneva la rotta prima
 * dell'errore). Il vecchio commento diceva che 6000 token stanno nei 60 s del
 * client: vero solo a 100 token al secondo.
 */
export const TEMPO_COPILOT_MS = 80_000;

/**
 * Il tetto della risposta del Copilot, in proporzione ai prodotti che vede
 * (circa 60 token l'uno), e non oltre quanto un fornitore lento (40 token al
 * secondo) scrive in un tentativo: 80 s × 40 = 3200, qui 3000. Oltre quella
 * misura la risposta non arriverebbe in tempo.
 */
export function tettoTokenCopilot(prodotti: number): number {
  return Math.min(3_000, 1024 + 60 * Math.max(0, prodotti));
}
