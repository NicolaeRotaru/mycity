/**
 * QUANTO RESTA BUONA UNA LETTURA DI CATALOGO CHE È UGUALE PER TUTTI.
 *
 * IL PROBLEMA (lasciato scritto il 3/9/2026 dalla squadra della scheda
 * prodotto, dopo aver chiuso il precarico). Il precarico ha tolto i viaggi di
 * rete DEL BROWSER: la pagina parte già piena invece di riempirsi dopo. Ma la
 * lettura al database c'è ancora — l'ha solo fatta il server al posto del
 * telefono — e la fa a OGNI visita. Cento persone che aprono la home nello
 * stesso minuto sono cento volte le stesse due domande, con le stesse identiche
 * risposte. Le nostre letture crescono col numero di VISITATORI, non col numero
 * di ordini: è la curva che fa male al conto, ed è quella che nessuno spezzava.
 *
 * LA CURA è la più vecchia del mestiere: una risposta uguale per tutti si legge
 * una volta e si riusa. Sessanta secondi.
 *
 * Perché sessanta e non di più: il negoziante che pubblica un prodotto, o
 * Nicola che ricompone la home dal pannello, devono vedere il cambiamento
 * subito — «subito» per un negozio è un minuto, non un'ora. E perché non di
 * meno: sotto il minuto il riuso non copre più i picchi, che è quando serve.
 *
 * `stale-while-revalidate` è la parte che nessuno guarda e che conta: passati i
 * sessanta secondi la copia vecchia continua a essere servita mentre quella
 * nuova arriva. Senza, allo scadere del minuto tutte le visite in corso si
 * fermano insieme ad aspettare la stessa lettura — cioè il picco lo si crea
 * invece di toglierlo.
 *
 * ⚠️ QUESTO VALE SOLO SU QUELLO CHE È UGUALE PER TUTTI. Una risposta che dipende
 * da chi la chiede — un carrello, un ordine, un profilo — non va MAI dietro una
 * cache condivisa: finirebbe in mano alla persona dopo. In questa casa è già
 * successo una volta, col service worker, e la prova che lo impedisce si chiama
 * `le-pagine-private-non-restano-in-cache`.
 */

/** Per quanti secondi una lettura pubblica di catalogo è ancora buona. */
export const SECONDI_CATALOGO_FRESCO = 60;

/**
 * Per quanti secondi, dopo la scadenza, si può ancora servire la copia vecchia
 * mentre si va a prendere quella nuova.
 */
export const SECONDI_CATALOGO_RIPIEGO = 300;

/** Il valore esatto dell'intestazione, in una stringa sola. */
export const CACHE_CONTROL_CATALOGO_PUBBLICO =
  `public, s-maxage=${SECONDI_CATALOGO_FRESCO}, stale-while-revalidate=${SECONDI_CATALOGO_RIPIEGO}`;

/**
 * Le intestazioni di una risposta di catalogo pubblica.
 *
 * Sta in una funzione, e non scritta a mano in ogni rotta, per la ragione di
 * sempre: tre copie della stessa stringa diventano tre numeri diversi al primo
 * ripensamento, e nessuno se ne accorge — una cache non dà errore quando non
 * funziona, semplicemente non fa niente.
 */
export function intestazioniCatalogoPubblico(): Record<string, string> {
  return {
    'Cache-Control': CACHE_CONTROL_CATALOGO_PUBBLICO,
    'Content-Type': 'application/json; charset=utf-8',
  };
}

/**
 * La risposta di una lettura pubblica di catalogo: i dati, e l'intestazione che
 * dice per quanto valgono.
 */
export function rispostaCatalogoPubblico(dati: unknown): Response {
  return new Response(JSON.stringify(dati), {
    status: 200,
    headers: intestazioniCatalogoPubblico(),
  });
}

/**
 * La risposta quando la lettura non riesce.
 *
 * Non porta l'intestazione di cache: un errore messo in cache per un minuto è
 * un minuto di sito rotto per tutti, quando magari il guasto è durato un
 * istante.
 */
export function rispostaCatalogoNonRiuscita(): Response {
  return new Response(JSON.stringify({ errore: 'lettura non riuscita' }), {
    status: 503,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}
