/**
 * 12/11/2026 (R10-020) — «IL CANONE PARTE DOPO IL PRIMO INCASSO», DETTO IN UN POSTO SOLO.
 *
 * Un ordine del negozio incassato: pagato (carta, o contanti già registrati: PAID; anche se poi
 * rimborsato in parte, come in migrations/215) oppure in contanti e consegnato. Lo usano la
 * cassa dell'abbonamento (app/api/seller/subscription/checkout) e il banner che invita ad
 * attivarlo (components/seller/SubscriptionBanner): il banner non deve invitare chi la cassa
 * poi rifiuta (collaudo K03). È un filtro `.or(...)` di PostgREST sulla tabella orders.
 * Definizione approvata dalla regista, da confermare da Nicola.
 */
export const FILTRO_PRIMO_INCASSO =
  'payment_status.in.(PAID,PARTIALLY_REFUNDED),and(payment_method.eq.cod,delivery_status.eq.DELIVERED)';
