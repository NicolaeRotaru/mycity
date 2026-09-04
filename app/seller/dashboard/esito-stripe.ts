/**
 * COSA DIRE AL NEGOZIANTE QUANDO TORNA DA STRIPE.
 *
 * 3/9/2026 — «CONFIGURAZIONE PAGAMENTI AGGIORNATA!» COMPARIVA SEMPRE.
 *
 * Finito l'inserimento dell'IBAN, Stripe rimanda il negoziante sul cruscotto.
 * La pagina richiamava la rotta che rilegge lo stato da Stripe, buttava via la
 * risposta e mostrava il messaggio verde. Anche quando Stripe non aveva
 * attivato niente. Anche quando la chiamata falliva del tutto.
 *
 * Anna di Pane Quotidiano finisce con i documenti ancora da caricare, legge che
 * è tutto a posto e comincia a vendere. Gli incassi restano fermi su Stripe per
 * giorni, e il primo bonifico slitta: è esattamente il momento in cui un
 * negozio nuovo decide se fidarsi.
 *
 * La causa non era il messaggio: era che il messaggio non nasceva da nessuno
 * stato. Qui lo stato diventa l'unico ingresso, e il messaggio l'unica uscita.
 * La pagina non ha più niente da decidere, quindi non può più sbagliare: per
 * far ricomparire il verde a vuoto bisognerebbe cambiare questa funzione, e la
 * prova in tests/unit/tornando-da-stripe-il-negozio-legge-lo-stato-vero
 * diventa rossa.
 *
 * Il modello era già scritto due cartelle più in là:
 * components/rider/RiderConnectButton.tsx legge `payouts_enabled` e cambia
 * messaggio.
 *
 * 🟢 Pura: niente rete, niente React, niente orologio. Una prova la ESEGUE.
 */

/** Quello che risponde /api/stripe/connect/refresh-status. */
export type StatoConnect = {
  connected?: boolean;
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  details_submitted?: boolean;
  /** I dati che Stripe aspetta ancora. Sono codici tecnici: non si mostrano. */
  currently_due?: string[];
  disabled_reason?: string | null;
};

export type EsitoRientro = {
  /** `ok` = può incassare · `attesa` = Stripe non ha finito · `ignoto` = non l'ho potuto verificare. */
  tono: 'ok' | 'attesa' | 'ignoto';
  /** La riga che il negoziante legge. */
  titolo: string;
  /** Cosa manca, in parole sue. Assente quando non c'è niente da fare. */
  dettaglio?: string;
};

/**
 * Cosa manca perché Stripe attivi i pagamenti, detto senza codici.
 *
 * I nomi che arrivano in `currently_due` sono sigle di Stripe
 * (`individual.verification.document`): mostrarle sarebbe come non dire
 * niente. Si dice quante cose mancano e dove si completano.
 */
export function cosaMancaAStripe(stato: StatoConnect): string {
  if (stato.connected === false) {
    return 'Il collegamento con Stripe non risulta iniziato: aprilo dalla pagina Guadagni.';
  }
  const mancanti = stato.currently_due ?? [];
  if (mancanti.length > 0) {
    const quanti = mancanti.length === 1 ? 'un dato' : `${mancanti.length} dati`;
    return `Stripe aspetta ancora ${quanti} da te: completali dalla pagina Guadagni.`;
  }
  if (stato.disabled_reason) {
    return 'Stripe ha sospeso i pagamenti in attesa di una verifica: riprendila dalla pagina Guadagni.';
  }
  if (stato.details_submitted === false) {
    return 'La configurazione su Stripe non è stata completata: riprendila dalla pagina Guadagni.';
  }
  return 'Stripe sta ancora controllando i tuoi dati. Di solito ci vuole poco: ti avvisiamo appena è fatta.';
}

/**
 * Il messaggio nasce dallo stato che Stripe ha restituito.
 *
 * `null` vuol dire «non l'ho potuto verificare»: la chiamata non è riuscita, o
 * ha risposto male. Non è un sì e non è un no, e va detto così — un verde messo
 * lì per non lasciare la pagina muta è la bugia da cui è nato questo file.
 */
export function esitoRientroDaStripe(stato: StatoConnect | null | undefined): EsitoRientro {
  if (!stato) {
    return {
      tono: 'ignoto',
      titolo: 'Non sono riuscito a controllare i tuoi pagamenti.',
      dettaglio: 'Riprova fra un momento dalla pagina Guadagni: lì vedi sempre lo stato aggiornato.',
    };
  }
  if (stato.payouts_enabled) {
    return {
      tono: 'ok',
      titolo: 'Pagamenti attivi: gli incassi arriveranno sul tuo conto.',
    };
  }
  return {
    tono: 'attesa',
    titolo: 'Pagamenti non ancora attivi: Stripe deve finire di controllare.',
    dettaglio: cosaMancaAStripe(stato),
  };
}
