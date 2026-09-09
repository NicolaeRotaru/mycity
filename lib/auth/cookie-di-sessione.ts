/**
 * 8/9/2026 — IL RINNOVO DELLA SESSIONE NON DEVE PERDERSI PER STRADA.
 *
 * COSA SUCCEDE DAVVERO, IN PAROLE SEMPLICI.
 *
 * Quando una persona è dentro il sito, il suo browser tiene due tessere: una
 * che scade in fretta (serve a farsi riconoscere) e una che serve a farsene
 * dare una nuova. A ogni pagina il portiere chiede al servizio di accesso
 * «chi sei?». Se la prima tessera è scaduta, quella domanda NON è solo una
 * domanda: il servizio ne stampa una coppia nuova e **butta via la vecchia**.
 * Da quel momento la coppia che il browser ha in tasca non vale più niente.
 *
 * La coppia nuova torna indietro per una via sola: la libreria chiama la
 * callback `set()`, e quella scrive i cookie sulla risposta che stiamo per
 * mandare. Se la risposta che mandiamo davvero non è quella — perché ne
 * abbiamo costruita un'altra per un rimando, oppure perché abbiamo smesso di
 * aspettare — i cookie nuovi non partono. La persona resta con una tessera già
 * bruciata dal server: al click dopo è fuori, con il carrello a metà, senza
 * aver fatto niente di sbagliato.
 *
 * Non è una pagina lenta. È una disconnessione silenziosa.
 *
 * QUI DENTRO CI SONO I TRE PEZZI CHE MANCAVANO, E SI POSSONO PROVARE.
 *
 *  1. `creaRaccoglitoreCookie()` — una scatola che tiene TUTTO quello che il
 *     servizio di accesso decide sui cookie, invece di scriverlo dritto su una
 *     risposta che magari non partirà mai.
 *  2. `travasaCookie()` — versa quella scatola su qualunque risposta usciamo
 *     davvero, rimandi compresi. È la riga che oggi non esiste.
 *  3. `chiediConTettoSuScritturaDiSessione()` — il tetto di tempo per le
 *     chiamate che TOCCANO la sessione, tenuto separato da quello per le
 *     semplici letture. Chiude la scatola nello stesso istante in cui la
 *     risposta è decisa, e quello che arriva dopo lo conta invece di buttarlo.
 *
 * LE QUATTRO SCELTE, PRESE SEMPRE DALLA PARTE PIÙ SEVERA.
 *
 *  a) Si travasa TUTTO quello che la libreria ha scritto, comprese le
 *     CANCELLAZIONI. Perdere una cancellazione è la più permissiva delle
 *     dimenticanze: il server ha deciso di spegnere quella sessione e il
 *     browser continua a tenersela in tasca.
 *  b) Nel travaso l'ultima parola è del servizio di accesso: se sulla risposta
 *     c'era già un cookie con lo stesso nome, vince quello nuovo.
 *  c) Se il tetto di tempo è scattato, la consegna vale «forse persa», mai
 *     «andata bene». Non sappiamo se una rotazione fosse in volo, e la
 *     supposizione comoda qui costa la sessione di un cliente.
 *  d) Una scrittura che arriva a scatola chiusa non si consegna (non si può) e
 *     non si nasconde: si conta e si registra. È l'unico modo per sapere
 *     QUANTE volte succede — oggi quel numero non ce l'ha nessuno.
 */

import { TETTO_PORTIERE_MS, chiediConTetto, type Risposta } from './decisione-portiere';

/**
 * I cookie di sessione di Supabase si chiamano `sb-<progetto>-auth-token`, e
 * quando sono lunghi vengono spezzati in `…-auth-token.0`, `.1`. La regola sta
 * scritta qui una volta sola: `middleware.ts` ne teneva una copia sua, e due
 * copie della stessa regola sono due posti da ricordare il giorno che cambia.
 */
export function eCookieDiSessione(nome: string): boolean {
  return nome.startsWith('sb-') && nome.includes('-auth-token');
}

/** Le opzioni di un cookie, nella forma che accetta anche `NextResponse`. */
export type OpzioniCookie = {
  path?: string;
  domain?: string;
  maxAge?: number;
  expires?: Date;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: boolean | 'lax' | 'strict' | 'none';
  priority?: 'low' | 'medium' | 'high';
  partitioned?: boolean;
};

/** Un cookie pronto da scrivere su una risposta. */
export type CookieDaScrivere = OpzioniCookie & { name: string; value: string };

/** Quello che il servizio di accesso ha deciso su un cookie. */
export type CookieRaccolto = CookieDaScrivere & {
  /** `true` se era una cancellazione: la libreria ha chiamato `remove`. */
  rimozione: boolean;
  /** `true` se è arrivato quando la risposta era già decisa: non partirà. */
  tardivo: boolean;
};

/**
 * Qualunque cosa sappia scriversi un cookie addosso: `NextResponse`, ma anche
 * una risposta finta in una prova. Il file resta senza `next/server` dentro,
 * così la regola si può eseguire senza alzare un server.
 */
export type DestinazioneCookie = {
  cookies: { set(cookie: CookieDaScrivere): unknown };
};

export type RaccoglitoreCookie = {
  /** La callback `set()` che si passa al client Supabase. */
  set(nome: string, valore: string, opzioni?: OpzioniCookie): void;
  /** La callback `remove()` che si passa al client Supabase. */
  remove(nome: string, opzioni?: OpzioniCookie): void;
  /** Quello che si può ancora consegnare al browser, in ordine di arrivo. */
  daConsegnare(): CookieRaccolto[];
  /** Chiude la scatola: la risposta è decisa, da qui in poi non parte più niente. */
  sigilla(): void;
  sigillato(): boolean;
  /** Quello che è arrivato a scatola chiusa: perso, ma contato. */
  perse(): CookieRaccolto[];
  /** Il servizio di accesso ha toccato i cookie di sessione? */
  haToccatoLaSessione(): boolean;
  /** Da chiamare per ogni scrittura tardiva: è il contatore della frequenza. */
  alTardivo(quandoSucceede: (cookie: CookieRaccolto) => void): void;
};

/**
 * La scatola dove finisce tutto quello che il servizio di accesso decide sui
 * cookie, prima di sapere su quale risposta andrà a finire.
 *
 * Perché non scrivere dritto sulla risposta, come si faceva? Perché la
 * risposta che esce davvero spesso è un'altra: su cinque uscite del portiere
 * che rimandano altrove, tutte e cinque costruiscono una risposta nuova. Con
 * la scatola, la risposta si sceglie dopo e i cookie la raggiungono comunque.
 */
export function creaRaccoglitoreCookie(): RaccoglitoreCookie {
  const raccolti: CookieRaccolto[] = [];
  const tardivi: CookieRaccolto[] = [];
  const ascoltatori: Array<(cookie: CookieRaccolto) => void> = [];
  let chiusa = false;
  let sessioneToccata = false;

  const annota = (cookie: CookieDaScrivere, rimozione: boolean) => {
    if (eCookieDiSessione(cookie.name)) sessioneToccata = true;
    const voce: CookieRaccolto = { ...cookie, rimozione, tardivo: chiusa };
    if (chiusa) {
      // SCELTA (d): non si finge che sia andata bene. La risposta è già
      // partita, questo cookie non la raggiungerà mai — ma almeno lo sappiamo.
      tardivi.push(voce);
      for (const avvisa of ascoltatori) avvisa(voce);
      return;
    }
    raccolti.push(voce);
  };

  return {
    set(nome, valore, opzioni) {
      annota({ ...(opzioni ?? {}), name: nome, value: valore }, false);
    },
    remove(nome, opzioni) {
      // Una cancellazione è un cookie con il valore vuoto: è così che la
      // scrive `@supabase/ssr`, ed è così che deve arrivare al browser.
      annota({ ...(opzioni ?? {}), name: nome, value: '' }, true);
    },
    daConsegnare() {
      return [...raccolti];
    },
    sigilla() {
      chiusa = true;
    },
    sigillato() {
      return chiusa;
    },
    perse() {
      return [...tardivi];
    },
    haToccatoLaSessione() {
      return sessioneToccata;
    },
    alTardivo(quandoSucceede) {
      ascoltatori.push(quandoSucceede);
    },
  };
}

/**
 * VERSA I COOKIE RACCOLTI SULLA RISPOSTA CHE ESCE DAVVERO.
 *
 * È la riga che mancava. Il portiere costruisce una risposta nuova ogni volta
 * che rimanda altrove — alla schermata di accesso, alla verifica dell'email,
 * al pannello del venditore — e quella risposta nuova nasce senza niente
 * addosso. I cookie che il servizio di accesso aveva appena stampato restavano
 * sulla risposta scartata.
 *
 * Restituisce quanti ne ha versati, così chi chiama può dirlo nei log.
 */
export function travasaCookie(
  cookie: readonly CookieRaccolto[],
  destinazione: DestinazioneCookie,
): number {
  let versati = 0;
  for (const c of cookie) {
    // SCELTA (a) + (b): passano anche le cancellazioni, e l'ultima parola è di
    // chi ha deciso qui — se sulla risposta c'era già un cookie con questo
    // nome, viene coperto.
    const { rimozione: _rimozione, tardivo: _tardivo, ...daScrivere } = c;
    destinazione.cookies.set(daScrivere);
    versati += 1;
  }
  return versati;
}

/** Com'è andata la consegna della sessione al browser. */
export type StatoConsegna = 'consegnata' | 'forse-persa' | 'persa';

export type EsitoConsegna = {
  stato: StatoConsegna;
  /**
   * Ci si può fidare della sessione che il browser ha in mano dopo questa
   * risposta? Se no, chi chiama NON deve trattarla come una sessione buona.
   */
  sessioneAffidabile: boolean;
  /** La riga da lasciare nei log, o `null` se non è successo niente di strano. */
  registra: string | null;
};

/**
 * «È PARTITO TUTTO» E «FORSE SI È PERSO QUALCOSA» NON SONO LA STESSA COSA.
 *
 * SCELTA (c), la più severa: appena il tetto di tempo scatta, la consegna non
 * può più valere «andata bene». Non sappiamo se in quel momento il servizio
 * stesse stampando la coppia nuova di tessere — e se la stava stampando, il
 * browser è già rimasto indietro. Dire di sì per comodità qui costa la
 * sessione di un cliente in mezzo alla cassa.
 */
export function verificaConsegnaSessione(
  esito: Risposta<unknown>['stato'],
  raccoglitore: RaccoglitoreCookie,
): EsitoConsegna {
  if (raccoglitore.perse().length > 0) {
    return {
      stato: 'persa',
      sessioneAffidabile: false,
      registra:
        '[portiere] il servizio di accesso ha rinnovato la sessione quando la risposta era gia partita: il browser e rimasto con la tessera vecchia',
    };
  }
  if (esito !== 'ok') {
    return {
      stato: 'forse-persa',
      sessioneAffidabile: false,
      registra:
        '[portiere] ho smesso di aspettare il servizio di accesso: se stava rinnovando la sessione, il rinnovo non arriva al browser',
    };
  }
  return { stato: 'consegnata', sessioneAffidabile: true, registra: null };
}

export type EsitoScritturaSessione<T> = {
  /** Com'è andata la chiamata: la stessa forma di sempre. */
  risposta: Risposta<T>;
  /** I cookie da versare sulla risposta che esce, qualunque essa sia. */
  daConsegnare: CookieRaccolto[];
  /** Se il browser è rimasto allineato al server, o no. */
  consegna: EsitoConsegna;
};

/**
 * IL TETTO DI TEMPO PER LE CHIAMATE CHE TOCCANO LA SESSIONE.
 *
 * LA CAUSA RADICE, IN UNA RIGA: lo stesso tetto era stato messo su una lettura
 * (leggere il profilo) e su una chiamata che CAMBIA lo stato dell'accesso
 * (`auth.getUser()`, che quando la tessera è scaduta ne stampa una nuova e
 * brucia la vecchia). Su una lettura, smettere di aspettare non costa niente.
 * Su un rinnovo, smettere di aspettare lascia il server e il browser con due
 * verità diverse.
 *
 * Da qui in poi le due cose hanno due funzioni con due nomi: `chiediConTetto`
 * per le letture, questa per le scritture. Chi scriverà il prossimo pezzo di
 * portiere deve inciampare nel nome, non nel bug.
 */
export async function chiediConTettoSuScritturaDiSessione<T>(
  fai: () => PromiseLike<T>,
  raccoglitore: RaccoglitoreCookie,
  ms: number = TETTO_PORTIERE_MS,
): Promise<EsitoScritturaSessione<T>> {
  const risposta = await chiediConTetto(fai, ms);
  // Il sigillo va messo QUI: nello stesso momento in cui la risposta è
  // decisa. Quello che il servizio di accesso scriverà dopo non può più
  // partire, e la scatola smette di accettarlo come se potesse.
  raccoglitore.sigilla();
  return {
    risposta,
    daConsegnare: raccoglitore.daConsegnare(),
    consegna: verificaConsegnaSessione(risposta.stato, raccoglitore),
  };
}
