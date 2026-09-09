/**
 * IL CANCELLO FRA I CONTANTI E LA CARTA.
 *
 * ── Il difetto che ha prodotto questo file ──────────────────────────────────
 * Maria preme «Paga con carta»: il server le mette da parte l'ultima torta e le
 * apre la pagina di Stripe in una linguetta. Ci ripensa, torna sul sito e
 * sceglie «pago alla consegna». L'ordine in contanti nasce e la torta le viene
 * riassegnata. Ma la pagina di Stripe è ancora lì, e resta pagabile fino alla
 * fine della riserva: due ore. Se Maria ci rientra — tasto avanti, linguetta
 * rimasta aperta, portafoglio del telefono che completa da solo — la carta
 * viene addebitata per una torta che ha già comprato in contanti.
 *
 * ── Perché non bastava chiudere la pagina ───────────────────────────────────
 * La prima cura è stata chiudere la pagina su Stripe insieme alla riserva
 * (`liberaRiserveAbbandonate`). È giusta, ma è un'AZIONE: se non riesce —
 * Stripe irraggiungibile, chiamata rifiutata, oppure la pagina è appena stata
 * PAGATA e non si può più chiudere — l'errore finiva in un avviso nel registro
 * e l'ordine in contanti nasceva lo stesso. Restava in piedi la coppia che non
 * deve esistere: un ordine in contanti e una pagina con la carta ancora viva.
 *
 * ── La regola, adesso ───────────────────────────────────────────────────────
 * **Se non siamo certi che la pagina con la carta sia morta, l'ordine in
 * contanti non nasce.** Delle due porte ne resta aperta una sola, sempre: o si
 * chiude la carta e si incassa in contanti, o si lascia vivere la carta e i
 * contanti si rifiutano con un messaggio che invita a riprovare.
 *
 * Rifiutare non perde l'ordine: la riserva vecchia resta in piedi (non si è
 * liberato niente), la persona riprova, e al secondo giro o la pagina si chiude
 * davvero o è già morta da sé. Perdere un ordine si recupera in trenta secondi;
 * un addebito seguito da un rimborso che si vede dopo giorni è una telefonata
 * all'assistenza e un cliente che non torna.
 *
 * Questa funzione è pura apposta: non parla né con Stripe né col database, così
 * la regola si può ESEGUIRE in una prova invece di raccontarla in un commento.
 */

/** Il resoconto che `liberaRiserveAbbandonate` consegna a chi l'ha chiamata. */
export type RiserveLiberate = {
  /** I tentativi abbandonati che sono stati davvero chiusi e rimessi a scaffale. */
  liberati: string[];
  /**
   * Le pagine di pagamento che NON siamo riusciti a rendere non pagabili.
   * Il campo è obbligatorio apposta: era la sua versione facoltativa a lasciare
   * che qualcuno se ne dimenticasse.
   */
  ancoraPagabili: string[];
};

export type EsitoCancello =
  | { puoNascere: true }
  | { puoNascere: false; motivo: string; sessioni: string[] };

/**
 * Il messaggio che legge chi sta comprando. Dice cosa fare, non cosa è successo
 * dentro: «riprova» è l'unica azione utile, e al secondo tentativo funziona.
 */
export const MOTIVO_CARTA_ANCORA_APERTA =
  'Hai un pagamento con la carta ancora aperto su questi articoli. ' +
  'Chiudi quella pagina e riprova fra qualche secondo: non ti verrà addebitato niente due volte.';

/**
 * Decide se un ordine in contanti può nascere, visto com'è andata la chiusura
 * dei tentativi con la carta dello stesso cliente sugli stessi prodotti.
 *
 * Il criterio è uno solo e non ha eccezioni: **anche una sola** pagina rimasta
 * pagabile ferma tutto. Non si guarda quante ne sono state chiuse: una porta
 * aperta basta a far pagare due volte.
 */
export function ordineInContantiPuoNascere(riserve: RiserveLiberate): EsitoCancello {
  const sessioni = [
    ...new Set(
      (riserve?.ancoraPagabili ?? []).filter((s): s is string => typeof s === 'string' && s.trim() !== ''),
    ),
  ];
  if (sessioni.length === 0) return { puoNascere: true };
  return { puoNascere: false, motivo: MOTIVO_CARTA_ANCORA_APERTA, sessioni };
}
