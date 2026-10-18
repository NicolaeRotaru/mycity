/**
 * Un ordine annullato ha ancora soldi del cliente sulla carta da restituire?
 *
 * 16/10/2026 — IL GIRO NOTTURNO NON RIMBORSAVA IL RESTO DOPO IL CRUSCOTTO.
 *
 * Il giro che annulla gli ordini mai accettati (`expire-stale-orders`)
 * rimborsava solo se il pagamento era «PAID». Ma un rimborso parziale fatto
 * dal cruscotto Stripe, adesso che il webhook lo registra, porta l'ordine a
 * «PARTIALLY_REFUNDED». Un caso vero: 27,90 € pagati con la carta a Pane
 * Quotidiano, manca una focaccia e Nicola rimborsa 3 € dal cruscotto, il
 * negozio non accetta in tempo. Il giro annullava l'ordine come se fosse in
 * contanti: nessun rimborso, e 24,90 € del cliente restavano a MyCity senza
 * che nessuno lo sapesse.
 *
 * L'annullo del cliente, del negozio e dell'amministrazione (`annulla.ts`)
 * contava già il «rimborsato in parte» come pagato: la regola adesso sta qui,
 * una volta sola, e la usano tutti e due. Quanto restituire lo decide
 * `refundOrder`: il lordo meno quello che è già tornato al cliente.
 */
export type PagamentoDellOrdine = {
  payment_method: string | null;
  payment_status: string | null;
  stripe_payment_intent: string | null;
};

export function restaDaRimborsareSullaCarta(ordine: PagamentoDellOrdine): boolean {
  return (
    ordine.payment_method === 'card' &&
    !!ordine.stripe_payment_intent &&
    (ordine.payment_status === 'PAID' || ordine.payment_status === 'PARTIALLY_REFUNDED')
  );
}
