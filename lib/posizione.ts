/**
 * Chiedere la posizione: quando, e cosa dire quando va storta.
 *
 * TRE DIFETTI NELLO STESSO PUNTO, tutti su «Vicino a te».
 *
 * ① IL PERMESSO CHIESTO A FREDDO. La richiesta partiva appena la pagina si montava: il riquadro di
 *    sistema arrivava prima di qualsiasi contenuto, e senza una riga che dicesse perché. Un
 *    permesso chiesto così viene negato molto più spesso — e su iPhone, una volta negato, non lo
 *    richiede più nessuno: bisogna andare nelle impostazioni del telefono. Cioè un «no» dato in due
 *    secondi spegne la funzione per sempre.
 *
 * ② LA PAGINA BLOCCATA MENTRE ASPETTA. Il riquadro «Calcolo distanze…» copriva tutto finché la
 *    posizione non arrivava, con un tetto di dieci secondi — o per sempre, se la persona lasciava lì
 *    il riquadro di sistema senza rispondere. E i negozi erano già in mano: la lista non dipende
 *    dalla posizione, che serve solo a ORDINARLA. Si nascondeva una cosa pronta per aspettarne
 *    un'altra facoltativa.
 *
 * ③ L'ERRORE DEL BROWSER MOSTRATO COM'È. `err.message` lo scrive il browser, in inglese, e dice
 *    cose come «User denied Geolocation». Chi legge non capisce cosa è successo né cosa può fare.
 *
 * Qui stanno le due decisioni pure: cosa dire di un errore, e se la pagina può bloccarsi.
 */

/** I tre motivi che il browser sa dare, più quello che non sa dare. */
export type MotivoPosizione = 'negato' | 'non-disponibile' | 'troppo-lento' | 'non-lo-so';

/** I codici del browser. Sono numeri, e vale la pena scriverli una volta con un nome. */
export const NEGATO = 1;
export const NON_DISPONIBILE = 2;
export const TROPPO_LENTO = 3;

/**
 * Che cosa è successo, in una parola nostra.
 *
 * `code` è l'unico campo del quale ci si può fidare: `message` lo scrive il browser, cambia da
 * browser a browser ed è in inglese. Un codice che non conosciamo diventa «non lo so», non uno dei
 * tre a caso: dire «hai negato il permesso» a chi non l'ha negato è peggio che non dire niente.
 */
export function motivoPosizione(err?: { code?: number } | null): MotivoPosizione {
  switch (err?.code) {
    case NEGATO: return 'negato';
    case NON_DISPONIBILE: return 'non-disponibile';
    case TROPPO_LENTO: return 'troppo-lento';
    default: return 'non-lo-so';
  }
}

/**
 * La frase da mostrare: cosa è successo, e cosa si può fare.
 *
 * Ogni riga dice tutt'e due le cose. «Non è riuscito» da solo lascia la persona ferma.
 */
export function frasePosizione(motivo: MotivoPosizione): string {
  switch (motivo) {
    case 'negato':
      return 'Non hai dato il permesso di leggere la posizione. Puoi darlo dalle impostazioni del browser, oppure restare così: qui sotto ci sono comunque i negozi di Piacenza.';
    case 'non-disponibile':
      return 'Il telefono non è riuscito a dire dov\'è — capita al chiuso o con il GPS spento. Qui sotto ci sono comunque i negozi di Piacenza.';
    case 'troppo-lento':
      return 'La posizione ci sta mettendo troppo. Qui sotto ci sono comunque i negozi di Piacenza: riprova quando vuoi.';
    case 'non-lo-so':
      return 'Non sono riuscito a leggere la posizione, e il browser non ha detto perché. Qui sotto ci sono comunque i negozi di Piacenza.';
  }
}

/**
 * La pagina può bloccarsi ad aspettare?
 *
 * Solo per quello che le serve DAVVERO. I negozi sì: senza quelli non c'è niente da mostrare. La
 * posizione no: serve a ordinarli, e una lista non ordinata è infinitamente meglio di una schermata
 * di attesa su una cosa che magari non arriverà mai.
 */
export function siAspetta({ negoziInArrivo }: { negoziInArrivo: boolean }): boolean {
  return negoziInArrivo;
}
