/**
 * 16/10/2026 — LE AZIONI DEL REGISTRO E LE LORO ETICHETTE, IN UN POSTO SOLO.
 *
 * La pagina «Audit log» aveva la sua lista di etichette scritta a mano, e il
 * menu «Filtra per azione» nasceva da quella lista. Il lotto R33 ha aggiunto
 * 'order.cash_declared' — l'amministratore che registra i contanti al posto del
 * fattorino, un'operazione sui soldi — senza etichetta: il filtro non la offriva,
 * e la pagina legge solo le ultime 200 righe. Bastavano un paio di giornate di
 * modifiche ai prodotti ('product.update', anche lei mai entrata nella lista)
 * per far sparire la riga dalla vista, senza modo di ritrovarla dal pannello.
 *
 * Adesso il tipo delle azioni nasce dall'elenco qui sotto, e le etichette sono
 * un `Record` su quel tipo: un'azione nuova senza etichetta non compila, e il
 * filtro le offre tutte. Il file non importa niente: lo legge anche la pagina,
 * che gira nel browser.
 */
export const AZIONI_AUDIT = [
  'user.approve',
  'user.reject',
  'user.suspend',
  'user.reactivate',
  'user.delete',
  'product.create',
  'product.update',
  'product.hide',
  'product.show',
  'order.refund',
  'order.force_cancel',
  // R33 — l'amministratore registra i contanti dichiarati dal fattorino.
  'order.cash_declared',
  'dispute.resolve_buyer',
  'dispute.resolve_seller',
  'dispute.reject',
  'coupon.create',
  'coupon.delete',
  'kyc.approve',
  'kyc.reject',
] as const;

export type AuditAction = (typeof AZIONI_AUDIT)[number];

export const ETICHETTE_AZIONI_AUDIT: Record<AuditAction, string> = {
  'user.approve': 'Utente approvato',
  'user.reject': 'Utente rifiutato',
  'user.suspend': 'Utente sospeso',
  'user.reactivate': 'Utente riattivato',
  'user.delete': 'Utente eliminato',
  'product.create': 'Prodotto creato',
  'product.update': 'Prodotto modificato',
  'product.hide': 'Prodotto nascosto',
  'product.show': 'Prodotto reso visibile',
  'order.refund': 'Ordine rimborsato',
  'order.force_cancel': 'Ordine cancellato (forzato)',
  'order.cash_declared': 'Contanti registrati al posto del fattorino',
  'dispute.resolve_buyer': 'Reclamo risolto a favore del buyer',
  'dispute.resolve_seller': 'Reclamo risolto a favore del seller',
  'dispute.reject': 'Reclamo rifiutato',
  'coupon.create': 'Coupon creato',
  'coupon.delete': 'Coupon eliminato',
  'kyc.approve': 'KYC approvato',
  'kyc.reject': 'KYC rifiutato',
};

/** L'etichetta di un'azione letta dal registro; un codice sconosciuto resta com'e'. */
export function etichettaAzioneAudit(azione: string): string {
  return (ETICHETTE_AZIONI_AUDIT as Record<string, string>)[azione] ?? azione;
}

/** Le scelte del menu «Filtra per azione»: tutte le azioni che il registro puo' contenere. */
export function opzioniFiltroAudit(): Array<{ valore: AuditAction; etichetta: string }> {
  return AZIONI_AUDIT.map((valore) => ({ valore, etichetta: ETICHETTE_AZIONI_AUDIT[valore] }));
}
