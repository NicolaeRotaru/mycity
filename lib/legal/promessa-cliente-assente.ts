import { ORDER_STATUS_LABEL, PASSAGGI_LECITI, type ChiCambiaStato, type OrderStatus } from '@/lib/order-status';

/**
 * 8/9/2026 — I TERMINI PROMETTEVANO UN ESITO CHE IL SITO NON SA REGISTRARE.
 *
 * Il §6 dei Termini diceva al cliente: se non sei in casa il Rider «tenterà il
 * contatto telefonico e, in caso di esito negativo dopo tre tentativi, l'ordine
 * potrà essere annullato con rimborso al netto delle spese di consegna
 * sostenute». Tre promesse in una riga, e nel codice non ce n'era nessuna:
 *
 *   ① l'esito «cliente assente» non esiste. Da «in consegna» il fattorino ha
 *      una sola strada, il codice di consegna che porta a DELIVERED
 *      (`verify_delivery_code`): nessun altro esito, nessun pulsante, nessuno
 *      stato d'arrivo diverso in `PASSAGGI_LECITI`;
 *   ② i tentativi telefonici non li registra niente. Nei tipi generati del
 *      database non c'è nessuna tabella né colonna dei tentativi di contatto;
 *   ③ il rimborso al netto non esiste. L'unica strada è l'annullamento
 *      dall'amministrazione, e `annullaERimborsa` chiede a Stripe
 *      `total_price − già_rimborsato`: la quota di consegna sta dentro
 *      `total_price` e nessuno la scomputa. Torna tutto.
 *
 * ── PERCHÉ SI CORREGGE LA PROMESSA E NON SI SCRIVE L'ESITO ──────────────────
 *
 * Non è pigrizia, è la parte che vale: quella clausola toglie soldi a un
 * consumatore sulla base di un fatto — «tre telefonate andate a vuoto» — che il
 * sito non sa provare. Una trattenuta senza prova non regge da nessuna parte:
 * non davanti al cliente che contesta, non davanti alla banca che chiede le
 * evidenze di una contestazione carta. Scrivere l'esito prima di aver deciso la
 * procedura vera (quante telefonate, in quanti minuti, chi tiene la merce
 * fresca, chi paga il giro a vuoto) vorrebbe dire scrivere in codice una
 * decisione che non è mai stata presa. Quella decisione è di Nicola e di
 * operations, non di un file.
 *
 * Nel frattempo la cosa vera è che il cliente riprende tutto, spese comprese, e
 * i Termini adesso lo dicono. Ripasso: promettiamo MENO di prima al nostro
 * favore e di più al suo — un cambiamento in favore del consumatore, che non ha
 * bisogno di una nuova accettazione.
 *
 * ── PERCHÉ IL DIFETTO NON PUÒ TORNARE ──────────────────────────────────────
 *
 * Il testo del §6 non è più scritto a mano dentro la pagina: lo GENERA
 * `paragrafiConsegne()` a partire da quello che il codice sa davvero fare. La
 * clausola dei tentativi e della trattenuta esce solo se tutte e tre le
 * condizioni sono vere insieme. Finché una manca, la pagina scrive la verità di
 * oggi da sé. Il giorno in cui l'esito viene costruito davvero, le tre
 * condizioni diventano vere e la clausola torna da sola, senza che nessuno si
 * ricordi di riaprire una pagina legale.
 */

export type PassaggioDiStato = { da: OrderStatus; a: OrderStatus; chi: ChiCambiaStato };

/** Come si chiamerebbe uno stato di mancata consegna, in una qualunque delle lingue del repo. */
const PAROLE_DI_MANCATA_CONSEGNA = /assent|non[_-]?consegn|undeliver|irreperib|fallit|riconsegn|nuovo[_-]?tentativ/i;

/**
 * I TENTATIVI DI CONTATTO NON LI REGISTRA NIENTE.
 *
 * Perché sia `true` serve un posto dove il tentativo resti scritto con la sua
 * ora e il suo esito: una tabella `delivery_attempts` o una colonna sugli
 * ordini. Oggi in `lib/database.types.ts` — che è generato dal database, non
 * scritto a mano — non c'è né l'una né l'altra. Lo ricontrolla
 * `tests/unit/i-termini-non-promettono-un-esito-che-il-codice-non-sa-registrare.test.ts`,
 * che diventa rosso il giorno in cui la colonna compare: è il momento di
 * rimettere questa riga a `true` e rileggere il §6.
 */
export const TENTATIVI_DI_CONTATTO_REGISTRATI = false;

/**
 * QUANTO TORNA AL CLIENTE quando l'ordine si annulla dopo una consegna fallita.
 *
 * `lib/ordini/annulla.ts` calcola `residuoCent = totaleCent − giaRimborsato` e
 * lo passa a Stripe: `total_price` comprende la quota di consegna e nessuno la
 * scomputa. Quindi: integrale. La colonna per farlo diversamente esiste già
 * (`orders.shipping_cost`), manca la decisione, non il dato.
 */
export const RIMBORSO_SU_CONSEGNA_FALLITA: 'integrale' | 'al_netto_della_consegna' = 'integrale';

export type FattiDellaConsegna = {
  /** Il fattorino, da «in consegna», ha un esito diverso da «consegnato»? */
  esitoDiMancataConsegna: boolean;
  /** I tentativi di contatto restano scritti da qualche parte? */
  tentativiRegistrati: boolean;
  /** Cosa torna al cliente. */
  rimborso: 'integrale' | 'al_netto_della_consegna';
};

/**
 * Gli stati d'arrivo che il fattorino può raggiungere da «in consegna».
 * Nasce dalla macchina degli stati, non da un elenco riscritto qui.
 */
export function esitiDelFattorinoInConsegna(
  passaggi: readonly PassaggioDiStato[] = PASSAGGI_LECITI,
): OrderStatus[] {
  return passaggi
    .filter((p) => p.da === 'OUT_FOR_DELIVERY' && p.chi === 'fattorino')
    .map((p) => p.a);
}

/**
 * Cosa sa fare il codice, oggi, quando la consegna non riesce.
 *
 * I due elenchi arrivano da fuori apposta: così una prova può chiedere «e se la
 * macchina degli stati avesse l'esito?» ed eseguire la risposta, invece di
 * ragionarci sopra.
 */
export function fattiDellaConsegna(
  passaggi: readonly PassaggioDiStato[] = PASSAGGI_LECITI,
  statiConosciuti: readonly string[] = Object.keys(ORDER_STATUS_LABEL),
  tentativiRegistrati: boolean = TENTATIVI_DI_CONTATTO_REGISTRATI,
  rimborso: FattiDellaConsegna['rimborso'] = RIMBORSO_SU_CONSEGNA_FALLITA,
): FattiDellaConsegna {
  const perIlFattorino = esitiDelFattorinoInConsegna(passaggi).some((a) => a !== 'DELIVERED');
  const traGliStati = statiConosciuti.some((s) => PAROLE_DI_MANCATA_CONSEGNA.test(s));
  return {
    esitoDiMancataConsegna: perIlFattorino || traGliStati,
    tentativiRegistrati,
    rimborso,
  };
}

/**
 * La clausola che trattiene le spese di consegna si può scrivere solo se tutte
 * e tre le gambe esistono: l'esito, la prova dei tentativi, il rimborso al
 * netto. Con due su tre è di nuovo una promessa che il sito non mantiene.
 */
export function siPuoPromettereLaTrattenuta(fatti: FattiDellaConsegna = fattiDellaConsegna()): boolean {
  return fatti.esitoDiMancataConsegna && fatti.tentativiRegistrati && fatti.rimborso === 'al_netto_della_consegna';
}

/** Quante telefonate promettere. Vale solo quando la procedura esiste davvero. */
export const TENTATIVI_PROMESSI = 3;

/**
 * Il testo del §6 «Consegne», generato da quello che il codice sa fare.
 * La pagina lo stampa e basta: non ha copia sua da tenere allineata.
 */
export function paragrafiConsegne(fatti: FattiDellaConsegna = fattiDellaConsegna()): string[] {
  const apertura =
    'Le consegne sono affidate a Rider partner. I tempi indicati sono stimati e non vincolanti, ' +
    'salvo diversa garanzia espressa. È responsabilità dell’Acquirente essere reperibile ' +
    'all’indirizzo indicato e al recapito telefonico lasciato al momento dell’ordine.';

  if (siPuoPromettereLaTrattenuta(fatti)) {
    return [
      apertura,
      `In caso di assenza il Rider effettua fino a ${TENTATIVI_PROMESSI} tentativi di contatto telefonico, ` +
        'registrati con data e ora sull’ordine. Se nessun tentativo va a buon fine l’ordine è annullato e ' +
        'l’importo è rimborsato al netto delle spese di consegna sostenute, che restano a carico ' +
        'dell’Acquirente. I tentativi registrati sono consultabili dall’Acquirente nel dettaglio dell’ordine.',
    ];
  }

  return [
    apertura,
    'Se la consegna non riesce perché l’Acquirente non è reperibile, l’ordine non si chiude da solo: ' +
      'resta in stato «in consegna» finché non interviene l’assistenza. Segnalalo dal modulo Contatti ' +
      'indicando il numero d’ordine.',
    'In questo caso l’ordine è annullato e l’importo pagato è rimborsato per intero, spese di consegna ' +
      'comprese, sullo stesso mezzo di pagamento usato per l’acquisto. Sugli ordini pagati alla consegna ' +
      'non è stato addebitato nulla.',
    'MyCity non trattiene le spese di consegna in caso di mancata consegna: una trattenuta ' +
      'richiederebbe la prova dei tentativi di contatto, che la piattaforma oggi non registra. Se e ' +
      'quando quella procedura sarà attiva, questa sezione lo dirà con il numero di tentativi e i tempi ' +
      'esatti, e la modifica sarà comunicata secondo l’art. 15.',
  ];
}
