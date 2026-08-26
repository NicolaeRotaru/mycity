/**
 * LA PORTA DELL'ASSISTENZA — chi può aprirla, e da dove.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IL DIFETTO CHE QUESTO FILE CHIUDE
 * ─────────────────────────────────────────────────────────────────────────────
 * La chat di assistenza era caricata nel pacchetto e irraggiungibile per chi compra.
 *
 * Il pulsante flottante si nascondeva ai compratori, e il commento sopra diceva il perché:
 * «per il buyer l'assistenza vive ora nella barra in basso (MobileTabBar)». Ma quella porta non è
 * mai stata aperta: `isSupport` esiste nel tipo della scheda e nel disegno della barra — il bottone,
 * `aria-haspopup`, l'apertura del modale — e NESSUN elenco di schede lo imposta. Né quello di chi ha
 * fatto l'accesso, né quello dell'ospite, né venditore o fattorino.
 *
 * Quindi: una porta chiusa a chiave in favore di una porta che non è mai stata costruita. Il menu
 * dell'account offriva solo FAQ. Chi comprava non aveva nessun modo di scrivere all'assistenza.
 *
 * Che i compratori fossero il pubblico previsto lo dice il codice stesso, non una supposizione: il
 * pulsante calcola ancora `role = isSeller ? 'seller' : isRider ? 'rider' : 'buyer'`, e quel
 * `'buyer'` finale era irraggiungibile — un ramo scritto per qualcuno che non poteva arrivarci.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PERCHÉ È UNA FUNZIONE E NON UN `if` DENTRO IL COMPONENTE
 * ─────────────────────────────────────────────────────────────────────────────
 * Perché la prova possa ESEGUIRE la decisione invece di rileggere il componente. Un test che cerca
 * `isBuyer` nel file non distingue «tolto» da «spostato due righe più in giù»: il difetto che
 * chiudiamo è nato proprio da una decisione presa in un posto e documentata in un altro.
 */

export type ChiGuarda = {
  isAuthenticated: boolean;
  isAdmin: boolean;
  isSeller: boolean;
  isRider: boolean;
  isBuyer: boolean;
};

/** Le strade in cui il pulsante non va mostrato: l'accesso, e dentro un thread di messaggi. */
export function stradaSenzaPulsante(pathname: string): boolean {
  const p = pathname ?? '';
  return (
    p.startsWith('/sign-in') ||
    p.startsWith('/sign-up') ||
    p.startsWith('/reset-password') ||
    p.startsWith('/auth/') ||
    /^\/messages\/[^/]+/.test(p)
  );
}

/**
 * Il pulsante dell'assistenza si vede?
 *
 * Chi ha fatto l'accesso sì — compratori compresi, ed è il punto. L'amministratore no: per lui
 * l'assistenza non è prevista, ha gli strumenti suoi. Chi non ha fatto l'accesso no: senza un
 * account non c'è un thread a cui attaccare la conversazione.
 */
export function pulsanteAssistenzaVisibile(chi: ChiGuarda, pathname: string): boolean {
  if (!chi.isAuthenticated) return false;
  if (chi.isAdmin) return false;
  if (stradaSenzaPulsante(pathname)) return false;
  return true;
}

/** Con che cappello si presenta chi scrive. Il compratore è il caso normale, non il ripiego. */
export function ruoloAssistenza(chi: ChiGuarda): 'seller' | 'rider' | 'buyer' {
  if (chi.isSeller) return 'seller';
  if (chi.isRider) return 'rider';
  return 'buyer';
}
