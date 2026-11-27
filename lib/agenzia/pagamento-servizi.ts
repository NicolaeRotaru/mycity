/**
 * COME SI PAGA L'ABBONAMENTO DEI SERVIZI — 26/11/2026.
 *
 * Nicola: «non si può abbonare al momento tramite la piattaforma perché non è pronta, quindi tasto
 * abbona e toglilo» e «lui non paga online, paga con i contanti per il momento finché non è pronta la
 * piattaforma per i pagamenti».
 *
 * Un interruttore solo, letto da tutte le strade che aprono la cassa Stripe dei servizi (il link del
 * preventivo, il «Paga» dello stesso link, la pagina «Abbonamento» del negozio) e dalle pagine che
 * mostrano i pulsanti. Spento: nessuna cassa si apre, il titolare accetta il preventivo e paga in
 * contanti di persona. Quando la piattaforma dei pagamenti è pronta, si riaccende QUI, con la firma
 * di Nicola: le casse, i buoni e il webhook sono rimasti come erano e le loro prove girano ancora.
 *
 * Il modulo non importa niente: lo leggono sia il server sia le pagine nel browser.
 */
export const PAGAMENTO_ONLINE_SERVIZI = false;

export function pagamentoOnlineAttivo(): boolean {
  return PAGAMENTO_ONLINE_SERVIZI;
}

/** La frase per il titolare, dove prima c'era il pulsante per pagare. */
export const FRASE_CONTANTI = 'Per ora l’abbonamento si paga in contanti, di persona: il pagamento online sul sito arriva più avanti.';

/** La risposta delle porte che aprivano la cassa, finché il pagamento online è spento. */
export const MESSAGGIO_CASSA_SPENTA = 'Il pagamento online non è ancora attivo: per ora l’abbonamento si paga in contanti, di persona. Scrivici e ci mettiamo d’accordo.';
