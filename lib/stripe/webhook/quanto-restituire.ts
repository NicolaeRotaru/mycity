/**
 * Quanto restituire a negozio e fattorino quando una contestazione bancaria si
 * chiude. Spostato da dispute.ts (R11-varie) perche' quel file ha un tetto di
 * righe: qui ci sono solo conti, senza scritture.
 */
import type Stripe from 'stripe';

/**
 * Quanto restituire alla vittoria: il promemoria messo da parte all'apertura
 * se c'è (più di zero), altrimenti il totale stornato come prima della 126.
 */
export function promemoriaOTotale(promemoria: number | null | undefined, totale: number | null | undefined): number {
  return (promemoria ?? 0) > 0 ? (promemoria as number) : (totale ?? 0);
}

/** Stati Stripe della richiesta di informazioni (inquiry): soldi non tolti. */
export function eUnaRichiestaDiInformazioni(dispute: Stripe.Dispute): boolean {
  return String(dispute.status ?? '').startsWith('warning_');
}

/**
 * 1/11/2026 — QUANTO RESTITUIRE, CONTANDO SOLO QUESTA CONTESTAZIONE.
 *
 * Senza promemoria si ricadeva sul totale stornato. Ma se il pagamento era
 * gia' stato rimborsato per intero (payment_status 'REFUNDED') prima della
 * contestazione, lo storno di quel totale e' del rimborso, non della banca:
 * la contestazione non ha tolto niente e alla vittoria non c'e' niente da
 * restituire (null: l'ordine non si rimette in coda). Ripagarlo voleva dire
 * pagare due volte negozio e fattorino.
 * Il ripiego sul totale resta solo per un pagamento non rimborsato per
 * intero (contestazione aperta prima della migrazione 126).
 */
export function stornatoDaQuestaContestazione(
  promemoria: number | null | undefined,
  totale: number | null | undefined,
  paymentStatus: unknown,
): number | null {
  if ((promemoria ?? 0) > 0) return promemoria as number;
  if (paymentStatus === 'REFUNDED') return null;
  return promemoriaOTotale(promemoria, totale);
}
