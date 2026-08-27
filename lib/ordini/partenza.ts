/**
 * QUANDO IL CHECKOUT È CHIUSO — l'ordine partito non torna indietro.
 *
 * PERCHÉ ESISTE, e perché è una funzione invece di una riga dentro la pagina.
 *
 * Il blocco del pulsante «Conferma ordine» era una riga sola nel componente:
 * `placeOrders.isPending || payWithStripe.isPending`. In React Query 5 lo stato
 * «in corso» si spegne DOPO che `onSuccess` è finito, non prima. Quindi esisteva
 * una finestra — fra la fine di `onSuccess` e il momento in cui il browser lascia
 * davvero la pagina — in cui il pulsante tornava premibile:
 *
 *   · contanti — `onSuccess` butta la chiave anti-doppione (`chiudiIlTentativo`),
 *     svuota il carrello e chiama `router.push`. Ma la pagina del checkout non
 *     ascolta `cart:updated`, quindi i suoi `groups` restano pieni e il pulsante
 *     ridiventa vivo mentre la navigazione è ancora in corso;
 *   · carta — dopo `window.location.assign(url)` il browser ci mette un attimo a
 *     lasciare la pagina, e in quell'attimo il pulsante è di nuovo vivo.
 *
 * Un secondo tocco in quella finestra crea un SECONDO ORDINE VERO, con una chiave
 * nuova perché la prima è stata appena buttata. Il cliente paga due volte.
 *
 * Finché la decisione era una riga dentro un componente React di 1.200 righe,
 * nessuna prova poteva eseguirla: si poteva solo rileggerla. Qui è una funzione
 * pura, e la prova può metterla esattamente nella finestra che rompeva.
 */

/** Lo stato di un invio, nella forma minima che serve a decidere. */
export type StatoInvio = {
  /** L'invio è partito e non è ancora tornato. */
  isPending: boolean;
  /** L'invio è riuscito. Da qui in poi questa pagina sta solo aspettando di sparire. */
  isSuccess: boolean;
};

/**
 * `true` quando NESSUN altro invio deve poter partire da questa pagina.
 *
 * `inPartenza` è il segnale che il componente alza come prima riga di `onSuccess` e
 * non abbassa mai più. `isSuccess` gli sta accanto per la finestra in cui React Query
 * ha già segnato il successo ma il render con `inPartenza` a `true` non è ancora
 * arrivato — un fotogramma, ed è il fotogramma che costa un ordine doppio.
 */
export function checkoutChiuso(inPartenza: boolean, contanti: StatoInvio, carta: StatoInvio): boolean {
  return (
    inPartenza || contanti.isPending || contanti.isSuccess || carta.isPending || carta.isSuccess
  );
}
