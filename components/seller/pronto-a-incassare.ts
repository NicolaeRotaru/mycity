/**
 * 314 — UNA regola per «il negozio può ricevere i soldi» e «prodotti
 * pubblicati», letta dalla lista «Completa il tuo negozio» e dal punteggio
 * della bacheca. Prima la lista guardava solo Stripe e i prodotti in vendita,
 * il punteggio anche l'IBAN dell'iscrizione e tutti i prodotti (bozze
 * comprese): nella stessa pagina uno diceva «fatto» e l'altro «da fare».
 *
 * L'IBAN conta: al lancio la carta è spenta e il bonifico dei contanti va
 * sull'IBAN del negozio; con la carta accesa conta Stripe.
 */
export type ProfiloPerIncassi = {
  stripe_charges_enabled?: boolean | null;
  stripe_payouts_enabled?: boolean | null;
  billing_iban?: string | null;
};

export function pagamentiPronti(p: ProfiloPerIncassi | null | undefined): boolean {
  if (!p) return false;
  return !!p.stripe_payouts_enabled || !!p.stripe_charges_enabled || !!(p.billing_iban && p.billing_iban.trim());
}

export const ETICHETTA_PAGAMENTI = 'Dati per ricevere i pagamenti (IBAN o Stripe)';

/** Un prodotto «pubblicato» è uno in vendita: bozze ed esauriti non contano. */
export function prodottiPubblicati(prodotti: Array<{ status?: string | null }>): number {
  return prodotti.filter((p) => p.status === 'available').length;
}
