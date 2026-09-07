/**
 * Come si installa MyCity sul telefono, e perché su iPhone la risposta è diversa.
 *
 * IL DIFETTO CHE QUESTO FILE CHIUDE. Il banner «installa l'app» si mostrava solo dopo aver ricevuto
 * l'evento `beforeinstallprompt`, che il browser emette per offrire l'installazione con un
 * pulsante. **Safari su iOS quell'evento non lo emette**, e nel codice non c'era nessun altro ramo:
 * su iPhone il banner non compariva mai, e non esisteva nessun modo per scoprire che l'app si può
 * mettere in schermata Home. Non è un dettaglio da poco per un marketplace di quartiere: chi compra
 * dal negozio sotto casa lo fa dal telefono, e l'icona in Home è la differenza fra tornare e non
 * tornare.
 *
 * PERCHÉ SU iPHONE NON SI PUÒ FARE UN PULSANTE. iOS non dà nessun modo di far partire
 * l'installazione dal codice: si può solo dire alla persona i due gesti da fare — Condividi, poi
 * «Aggiungi a Home». Quindi non c'è UNA risposta: ce ne sono tre.
 *
 *   · `pulsante`     → il browser ha offerto l'installazione: si preme e si installa.
 *   · `istruzioni`   → siamo su iPhone: nessun pulsante possibile, si spiegano i due gesti.
 *   · `niente`       → è già installata, o la persona ha detto di no, o è troppo presto.
 *
 * Tre risposte e non due, come per il resto di questa casa: fingere un pulsante che non installa
 * niente sarebbe peggio del silenzio.
 */

export type ComeSiInstalla = 'niente' | 'pulsante' | 'istruzioni';

export type Situazione = {
  /** L'evento del browser che permette l'installazione con un pulsante. Su iOS non arriva mai. */
  offertaDalBrowser: boolean;
  /** È un iPhone o un iPad, dove l'installazione si fa solo a mano. */
  eApple: boolean;
  /** È già stata aggiunta alla schermata Home: non c'è niente da proporre. */
  giaInstallata: boolean;
  /** La persona ha già chiuso questo banner: non si ripropone. */
  giaRifiutata: boolean;
  /** Quante volte è tornata. Sotto la soglia non si chiede niente. */
  visite: number;
  /** La soglia di visite sotto cui si sta zitti. */
  visiteMinime: number;
};

/**
 * ⚠️ L'ORDINE DELLE DOMANDE CONTA, e la prima è «è già installata?».
 *
 * Chi ha già l'icona in Home non deve vedere né pulsanti né istruzioni: proporgli di installare una
 * cosa che ha già è il modo più veloce per far chiudere il banner per sempre. Subito dopo viene il
 * rifiuto, perché una persona che ha detto di no ha detto di no anche se le visite crescono.
 */
export function comeSiInstalla(s: Situazione): ComeSiInstalla {
  if (s.giaInstallata) return 'niente';
  if (s.giaRifiutata) return 'niente';
  if (s.visite < s.visiteMinime) return 'niente';
  if (s.offertaDalBrowser) return 'pulsante';
  if (s.eApple) return 'istruzioni';
  return 'niente';
}

/**
 * È un dispositivo Apple da tasca o da tavolo?
 *
 * ⚠️ L'iPad SI TRAVESTE DA MAC. Da iPadOS 13 il browser dichiara «Macintosh» come farebbe un
 * computer, e cercare solo «iPad» lo perde: su quelli il banner resterebbe muto come prima. Un Mac
 * vero non ha punti di tocco, un iPad sì — è quello che li distingue.
 */
export function eApple(userAgent: string, puntiDiTocco = 0): boolean {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return true;
  return /Macintosh/i.test(userAgent) && puntiDiTocco > 1;
}

/**
 * PERCHÉ SU QUESTO TELEFONO LE NOTIFICHE NON SI POSSONO ACCENDERE.
 *
 * IL DIFETTO CHE QUESTO PEZZO CHIUDE. La pagina delle impostazioni conosceva due soli stati: le
 * notifiche si possono attivare, oppure «il tuo browser non supporta le notifiche push». Su iPhone
 * usciva sempre la seconda frase — e non è vera. Da iOS 16.4 le notifiche esistono, ma **solo
 * dentro l'app aggiunta alla schermata Home**: finché il sito è aperto in Safari, `PushManager`
 * non c'è, quindi il controllo lo scambiava per un browser vecchio.
 *
 * Chi legge «il tuo browser non supporta» chiude la pagina: nessuno gli ha detto che bastano due
 * gesti — Condividi, poi «Aggiungi a Home» — e che tornando lì il pulsante c'è. Sono i clienti da
 * telefono, cioè quasi tutti, e le notifiche dell'ordine sono il motivo per cui riaprono l'app.
 *
 * Le risposte sono due e non una, come per l'installazione qui sopra:
 *
 *   · `iphone-da-installare` → è un iPhone o un iPad NON ancora in schermata Home: si spiegano i
 *                              due gesti, perché dopo quelli le notifiche funzionano davvero.
 *   · `browser-senza-push`   → il browser non le sa fare, o le chiavi non sono configurate: qui
 *                              non c'è niente da suggerire, e promettere sarebbe peggio.
 *
 * ⚠️ La domanda «è già installata?» viene PRIMA. Un iPhone che è già in schermata Home e che
 * comunque non espone le notifiche non va rimandato a installare una cosa che ha già: quello è un
 * caso di browser senza push, e le istruzioni sarebbero un giro a vuoto.
 */
export type PercheNienteNotifiche = 'iphone-da-installare' | 'browser-senza-push';

export function percheNienteNotifiche(s: { eApple: boolean; giaInstallata: boolean }): PercheNienteNotifiche {
  if (s.giaInstallata) return 'browser-senza-push';
  return s.eApple ? 'iphone-da-installare' : 'browser-senza-push';
}
