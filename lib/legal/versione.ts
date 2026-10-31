/**
 * La versione dei testi legali che l'utente sta accettando.
 *
 * Sta in un file suo perché la usano tre punti che prima non si parlavano: il
 * modulo di registrazione, il pulsante Google e la pagina di accettazione per
 * chi è entrato senza passare da nessuno dei due. Quando i testi cambiano, qui
 * si alza il numero e da quel momento le nuove accettazioni portano la versione
 * nuova — che è l'unica cosa che serve il giorno in cui qualcuno contesta una
 * condizione.
 *
 * 31/10/2026 (ondata 6) — terms-3.0: commissione IVA inclusa e canone sospeso, pagamenti
 * come sono al lancio (contanti, bonifico al negozio ogni lunedì), esclusi dal recesso,
 * destinatario del modulo di recesso. La pagina dei Termini stampa questo numero.
 */
export const VERSIONE_TESTI_LEGALI = 'privacy-2.0+terms-3.0';
