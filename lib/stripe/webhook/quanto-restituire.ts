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
 *
 * R11-021 — E SE IL RIMBORSO ERA PARZIALE, DAL TOTALE SI TOGLIE LA SUA QUOTA.
 * Dopo un rimborso parziale lo stornato al negozio contiene anche la quota del
 * rimborso: senza promemoria si restituiva tutto, rimborso compreso, e MyCity
 * pagava di tasca sua la parte gia' resa al cliente. `quotaDelRimborso` e' la
 * parte del netto del negozio che il rimborso gli ha tolto (in proporzione al
 * lordo, come fa lo storno del rimborso).
 */
export function stornatoDaQuestaContestazione(
  promemoria: number | null | undefined,
  totale: number | null | undefined,
  paymentStatus: unknown,
  quotaDelRimborso?: number,
): number | null {
  if ((promemoria ?? 0) > 0) return promemoria as number;
  if (paymentStatus === 'REFUNDED') return null;
  if (paymentStatus === 'PARTIALLY_REFUNDED' && quotaDelRimborso !== undefined) {
    return Math.max(0, (totale ?? 0) - quotaDelRimborso);
  }
  return promemoriaOTotale(promemoria, totale);
}

/** R11-021 — La parte del netto del negozio tolta da un rimborso parziale: rimborsato / lordo × netto. */
export function quotaDelRimborsoSulNetto(o: {
  refunded_amount_cents?: number | null;
  gross_total_cents?: number | null;
  total_price?: number | string | null;
  seller_payout_cents?: number | null;
}): number | undefined {
  // QA 12/11 — senza il lordo (ordini nati prima della 124) si usa il totale, come lordoDellOrdine.
  const lordo = o.gross_total_cents ?? Math.round(Number(o.total_price ?? 0) * 100);
  if (lordo <= 0 || o.refunded_amount_cents == null) return undefined;
  return Math.round((Math.min(o.refunded_amount_cents, lordo) / lordo) * (o.seller_payout_cents ?? 0));
}

/**
 * R11-023 — La contestazione riguarda solo una parte del pagamento? Si confronta
 * l'importo contestato col lordo degli ordini del pagamento (come all'apertura).
 * Senza il lordo non si indovina: si tratta come contestazione intera, come prima.
 */
export function contestazioneDiUnaParte(
  dispute: Pick<Stripe.Dispute, 'amount'>,
  orders: ReadonlyArray<object>,
): boolean {
  const righe = orders as ReadonlyArray<{ gross_total_cents?: number | null; total_price?: number | string | null; refunded_amount_cents?: number | null }>;
  // QA 12/11 — dopo un rimborso la banca può contestare al massimo quello che resta: si confronta con
  // il lordo MENO i rimborsi, altrimenti una contestazione intera persa sembrava «di una parte».
  const lordo = righe.reduce(
    (s, o) => s + Math.max(0, (o.gross_total_cents ?? Math.round(Number(o.total_price ?? 0) * 100)) - (o.refunded_amount_cents ?? 0)),
    0,
  );
  const contestato = dispute.amount ?? 0;
  return lordo > 0 && contestato > 0 && contestato < lordo;
}
