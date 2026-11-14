import { CARTA_ACCESA } from '@/lib/funzioni-al-lancio';

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
  stripe_account_id?: string | null;
  stripe_charges_enabled?: boolean | null;
  stripe_payouts_enabled?: boolean | null;
  billing_iban?: string | null;
};

/**
 * R17-009 — La stessa condizione che usa il server prima del bonifico
 * (lib/stripe/payout.ts, releaseOrderPayout): conto Stripe E versamenti accesi.
 * Gli incassi accesi da soli non bastano: il server ferma il bonifico.
 */
export function stripePronto(p: ProfiloPerIncassi | null | undefined): boolean {
  return !!p && !!p.stripe_account_id && !!p.stripe_payouts_enabled;
}

/** L'IBAN che usa Nicola per il bonifico dei contanti: non vuoto e della forma di un IBAN. */
export function ibanValido(iban: string | null | undefined): boolean {
  if (!iban) return false;
  return /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban.replace(/\s+/g, '').toUpperCase());
}

/** Con la carta accesa conta Stripe (come il server); con la carta spenta conta l'IBAN (come la pagina bonifici). */
export function pagamentiPronti(
  p: ProfiloPerIncassi | null | undefined,
  cartaAccesa: boolean = CARTA_ACCESA,
): boolean {
  if (!p) return false;
  return cartaAccesa ? stripePronto(p) : ibanValido(p.billing_iban);
}

export const ETICHETTA_PAGAMENTI = CARTA_ACCESA
  ? 'Dati per ricevere i pagamenti (Stripe)'
  : 'Dati per ricevere i pagamenti (IBAN)';

/** Un prodotto «pubblicato» è uno in vendita: bozze ed esauriti non contano. */
export function prodottiPubblicati(prodotti: Array<{ status?: string | null }>): number {
  return prodotti.filter((p) => p.status === 'available').length;
}
