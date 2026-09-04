/**
 * 3/9/2026 — IL PORTIERE DEL SITO QUANDO IL FORNITORE NON RISPONDE.
 *
 * Il middleware è il portiere: a ogni pagina chiede al servizio di accesso
 * «chi sei?» e al database «che ruolo ha?». Quando quelle domande non
 * ricevono risposta succedevano tre cose, tutte sbagliate:
 *
 *  1. «Il fornitore non risponde» diventava «non ha fatto l'accesso»: chi era
 *     regolarmente dentro finiva sulla schermata di accesso, anche mentre
 *     stava comprando.
 *  2. Non c'era nessun tetto di tempo: un rallentamento di trenta secondi del
 *     fornitore diventava trenta secondi di pagina appesa, per ogni click.
 *  3. La scelta non era scritta da nessuna parte: era il risultato di due `if`
 *     messi in fila, quindi nessuno poteva provarla e nessuno la vedeva
 *     cambiare.
 *
 * Qui la decisione diventa una funzione sola, senza rete e senza `next/server`
 * dentro: riceve «il fornitore risponde o no», «c'è una persona verificata o
 * no», «la pagina è protetta o è catalogo pubblico», e restituisce cosa fare.
 * Il middleware la chiama e basta. Così la regola si può provare senza alzare
 * un server, e si legge in dieci righe invece che in cento.
 *
 * LA REGOLA, IN UNA FRASE: sul catalogo pubblico si tira dritto come ospite
 * (una vetrina che non si apre è un ordine perso), sulle aree protette si
 * chiude (un permesso dato per sbaglio non si torna a prendere). E quando non
 * abbiamo una risposta vera, non si mette niente da parte: «non ho potuto
 * chiedere» non è un ruolo, e in cache durerebbe dieci minuti.
 */

/**
 * Quanto il portiere aspetta, al massimo, una risposta.
 *
 * Tremila millisecondi: lo stesso tetto che hanno già le rotte di salute di
 * questo repo. Oltre, la persona sta guardando una pagina bianca — e la
 * risposta, quando arriva, non le serve più.
 */
export const TETTO_PORTIERE_MS = 3000;

/** Come è finita una chiamata al fornitore. */
export type Risposta<T> =
  | { stato: 'ok'; valore: T }
  | { stato: 'scaduto' }
  | { stato: 'rotto'; errore: unknown };

const SCADUTO: unique symbol = Symbol('scaduto');

/**
 * Chiede una cosa al fornitore e smette di aspettare dopo `ms`.
 *
 * ⚠️ LIMITE DICHIARATO: qui si smette di ASPETTARE, non si annulla la
 * chiamata. La richiesta parte lo stesso e la sua risposta viene buttata: il
 * tetto protegge la persona davanti allo schermo, non il fornitore. È
 * volutamente così, perché la libreria di accesso riprova da sola più volte e
 * un tetto sul singolo tentativo non limiterebbe l'attesa vera.
 */
export async function chiediConTetto<T>(
  fai: () => PromiseLike<T>,
  ms: number = TETTO_PORTIERE_MS,
): Promise<Risposta<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const scadenza = new Promise<typeof SCADUTO>((risolvi) => {
    timer = setTimeout(() => risolvi(SCADUTO), ms);
  });
  try {
    const esito = await Promise.race([Promise.resolve(fai()), scadenza]);
    if (esito === SCADUTO) return { stato: 'scaduto' };
    return { stato: 'ok', valore: esito as T };
  } catch (errore) {
    // Nel file del portiere non c'era un solo try/catch: uno scoppio qui
    // dentro diventava un errore cinquecento su una pagina di catalogo.
    return { stato: 'rotto', errore };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Quello che ci interessa di una risposta del fornitore: se porta un errore. */
type ConErrore = { error?: unknown } | null | undefined;

/**
 * «NON HA FATTO L'ACCESSO» E «NON HO POTUTO CHIEDERE» NON SONO LA STESSA COSA.
 *
 * Il servizio di accesso restituisce un errore anche nel caso normalissimo di
 * sessione scaduta o assente. Trattarlo come un guasto vorrebbe dire un avviso
 * a ogni sessione scaduta: cioè migliaia di avvisi inutili, e nessuno che
 * guarda più i log quando serve davvero.
 *
 * Quindi: sessione mancante o gettone rifiutato (le risposte 4xx) = la persona
 * non è entrata, tutto regolare. Tutto il resto — rete caduta, 5xx, errore
 * senza nome — = il fornitore è muto.
 */
const ERRORI_DI_SESSIONE = new Set([
  'AuthSessionMissingError',
  'AuthInvalidJwtError',
  'AuthInvalidTokenResponseError',
]);

export function erroreDaFornitoreMuto(errore: unknown): boolean {
  if (!errore) return false;
  const nome = (errore as { name?: string })?.name;
  if (nome && ERRORI_DI_SESSIONE.has(nome)) return false;
  const stato = (errore as { status?: number })?.status;
  if (typeof stato === 'number' && stato >= 400 && stato < 500) return false;
  return true;
}

export type StatoFornitore = 'risponde' | 'muto';

/** Il fornitore ha risposto davvero, o siamo al buio? */
export function comeStaIlFornitore(risposta: Risposta<ConErrore>): StatoFornitore {
  if (risposta.stato !== 'ok') return 'muto';
  return erroreDaFornitoreMuto(risposta.valore?.error) ? 'muto' : 'risponde';
}

export type StatoPortiere = {
  /** Il servizio di accesso ha risposto, o è muto? */
  fornitore: StatoFornitore;
  /** C'è una persona verificata dietro questa richiesta? */
  utenteTrovato: boolean;
  /** La pagina richiede l'accesso, o è catalogo pubblico? */
  areaProtetta: boolean;
};

export type Decisione = {
  /**
   * `prosegui` — c'è una persona verificata, si va avanti coi controlli.
   * `passa-come-ospite` — pagina pubblica: si mostra il catalogo senza sapere chi è.
   * `chiudi-al-login` — pagina protetta: si rimanda alla schermata di accesso.
   */
  azione: 'prosegui' | 'passa-come-ospite' | 'chiudi-al-login';
  /** Si può mettere da parte il ruolo per i prossimi dieci minuti? */
  scriviCookieRuolo: boolean;
  /** La riga di log da lasciare, o `null` se non è successo niente di strano. */
  registra: string | null;
};

/**
 * La decisione del portiere, scritta una volta sola.
 */
export function decidiPortiere(stato: StatoPortiere): Decisione {
  const { fornitore, utenteTrovato, areaProtetta } = stato;

  if (utenteTrovato) {
    // Sappiamo chi è: si prosegue. Se però la risposta è arrivata storta, non
    // la si mette da parte: durerebbe dieci minuti.
    return {
      azione: 'prosegui',
      scriviCookieRuolo: fornitore === 'risponde',
      registra:
        fornitore === 'muto'
          ? '[portiere] so chi e ma il servizio di accesso ha risposto storto: non metto niente da parte'
          : null,
    };
  }

  if (fornitore === 'muto') {
    return areaProtetta
      ? {
          azione: 'chiudi-al-login',
          scriviCookieRuolo: false,
          registra:
            '[portiere] non ho potuto chiedere chi e: chiudo l area protetta e rimando all accesso',
        }
      : {
          azione: 'passa-come-ospite',
          scriviCookieRuolo: false,
          registra:
            '[portiere] non ho potuto chiedere chi e: sul catalogo tiro dritto come ospite',
        };
  }

  // Il fornitore ha risposto e non c'è nessuno: è un visitatore, non un guasto.
  return {
    azione: areaProtetta ? 'chiudi-al-login' : 'passa-come-ospite',
    scriviCookieRuolo: false,
    registra: null,
  };
}

export type DecisioneProfilo = {
  /** Il ruolo appena letto si può mettere nel cookie firmato? */
  mettiInCache: boolean;
  registra: string | null;
};

/**
 * UN SECONDO STORTO DEL DATABASE NON DEVE DURARE DIECI MINUTI.
 *
 * Qui la soglia è più severa di sopra: NESSUN errore va in cache, nemmeno uno
 * di quelli «regolari». Se la lettura del profilo non è riuscita, da `profile`
 * vuoto esce «ruolo: nessuno, approvato: no» — e messa da parte, quella
 * risposta declassa un venditore approvato per i dieci minuti successivi,
 * anche dopo che il database è tornato a posto.
 */
export function decidiCacheProfilo(risposta: Risposta<ConErrore>): DecisioneProfilo {
  if (risposta.stato === 'scaduto') {
    return {
      mettiInCache: false,
      registra: '[portiere] il profilo non e arrivato entro il tetto di tempo: non lo metto da parte',
    };
  }
  if (risposta.stato === 'rotto') {
    return {
      mettiInCache: false,
      registra: '[portiere] la lettura del profilo si e rotta: non la metto da parte',
    };
  }
  if (risposta.valore?.error) {
    return {
      mettiInCache: false,
      registra: '[portiere] profilo non letto: non lo metto in cache o durerebbe dieci minuti',
    };
  }
  return { mettiInCache: true, registra: null };
}

/** Il motivo, in chiaro, da mettere nella riga di log. Senza dati personali. */
export function motivoLeggibile(risposta: Risposta<ConErrore>): string {
  if (risposta.stato === 'scaduto') return `nessuna risposta entro il tetto di tempo`;
  if (risposta.stato === 'rotto') {
    const e = risposta.errore;
    return e instanceof Error ? e.message : String((e as { message?: string })?.message ?? 'errore');
  }
  const err = risposta.valore?.error;
  if (!err) return 'nessun errore';
  return err instanceof Error ? err.message : String((err as { message?: string })?.message ?? 'errore');
}
