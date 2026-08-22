/**
 * La versione dei testi legali che l'utente sta accettando.
 *
 * Sta in un file suo perché la usano tre punti che prima non si parlavano: il
 * modulo di registrazione, il pulsante Google e la pagina di accettazione per
 * chi è entrato senza passare da nessuno dei due. Quando i testi cambiano, qui
 * si alza il numero e da quel momento le nuove accettazioni portano la versione
 * nuova — che è l'unica cosa che serve il giorno in cui qualcuno contesta una
 * condizione.
 */
export const VERSIONE_TESTI_LEGALI = 'privacy-2.0+terms-2.0';
