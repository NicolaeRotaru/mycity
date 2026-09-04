/**
 * LE NOTIFICHE PUSH SONO DEL DISPOSITIVO, NON DELL'ACCOUNT.
 *
 * Il permesso a mandare notifiche lo dà il browser, e resta attaccato a quel
 * browser finché qualcuno non lo toglie. La riga nel database invece è di una
 * persona sola. Le due cose si separano appena due persone usano lo stesso
 * apparecchio:
 *
 *   Anna accende le notifiche sul tablet di casa mercoledì, poi esce.
 *   Giovedì entra Bruno con il suo account, sullo stesso tablet.
 *   Il tablet è ancora iscritto con l'indirizzo di Anna: gli avvisi degli
 *   ordini di Anna compaiono sullo schermo mentre lo usa Bruno, e a Bruno non
 *   arriva niente — anche se in impostazioni legge «Notifiche attive», perché
 *   quella scritta guardava solo il browser.
 *
 * La cura sta qui, in un punto solo: chi esce dall'account si porta via anche
 * l'iscrizione di questo apparecchio. Prima si cancella la riga (finché la
 * sessione è ancora valida, altrimenti i permessi del database non lasciano
 * cancellare niente), poi si spegne l'iscrizione nel browser — e questo secondo
 * passo si fa SEMPRE, anche se il primo non è riuscito: un indirizzo spento non
 * riceve più niente, e la riga rimasta indietro la ripulisce l'invio alla prima
 * consegna fallita (lib/push/send.ts, errori 404 e 410).
 *
 * Le funzioni prendono da fuori tutto quello che toccano — il gestore delle
 * iscrizioni e la cancellazione della riga — così una prova può eseguirle
 * davvero, senza un browser e senza un database.
 */

/** L'iscrizione che il browser tiene per questo apparecchio. */
export type IscrizioneDelBrowser = {
  readonly endpoint: string;
  unsubscribe: () => Promise<boolean>;
};

/** Chi custodisce l'iscrizione: il `pushManager` del service worker. */
export type GestoreDelleIscrizioni = {
  getSubscription: () => Promise<IscrizioneDelBrowser | null>;
};

/** Cancella la riga di questo indirizzo. Restituisce l'esito di PostgREST. */
export type CancellaRiga = (endpoint: string) => PromiseLike<unknown>;

export type EsitoScollegamento = {
  /** C'era un'iscrizione da scollegare su questo apparecchio. */
  cera: boolean;
  /** Il browser non consegna più niente a questo apparecchio. */
  disiscritto: boolean;
  /** La riga nel database è stata cancellata davvero. */
  rigaCancellata: boolean;
};

const NIENTE_DA_FARE: EsitoScollegamento = { cera: false, disiscritto: false, rigaCancellata: false };

/**
 * Quanto si aspetta, al massimo, prima di lasciar uscire comunque.
 * Spegnere un'iscrizione vuol dire parlare col servizio di notifiche del
 * browser: su una rete lenta può metterci. Nessuno deve restare bloccato sulla
 * pagina perché il pulsante «Esci» sta aspettando una risposta da fuori.
 */
const ATTESA_MASSIMA = 3000;

function conLimiteDiTempo<T>(lavoro: Promise<T>, ripiego: T, millisecondi: number): Promise<T> {
  return new Promise<T>((risolvi) => {
    const orologio = setTimeout(() => risolvi(ripiego), millisecondi);
    lavoro.then(
      (esito) => { clearTimeout(orologio); risolvi(esito); },
      () => { clearTimeout(orologio); risolvi(ripiego); },
    );
  });
}

/** Una risposta di PostgREST è andata bene se non porta un errore. */
function andataBene(risposta: unknown): boolean {
  if (risposta && typeof risposta === 'object' && 'error' in risposta) {
    return !(risposta as { error: unknown }).error;
  }
  return true;
}

/**
 * Stacca le notifiche di questo apparecchio dall'account che sta uscendo.
 *
 * Non lancia mai: l'uscita dall'account non deve fermarsi perché una notifica
 * non si è potuta staccare. E non si ferma a metà: se la cancellazione della
 * riga fallisce, l'iscrizione del browser si spegne lo stesso — è quella che
 * fa arrivare gli avvisi di uno sullo schermo di un altro.
 */
export async function scollegaPushDaQuestoDispositivo({
  gestore,
  cancellaRiga,
  attesaMassima = ATTESA_MASSIMA,
}: {
  gestore: GestoreDelleIscrizioni | null | undefined;
  cancellaRiga?: CancellaRiga;
  attesaMassima?: number;
}): Promise<EsitoScollegamento> {
  if (!gestore) return NIENTE_DA_FARE;
  return conLimiteDiTempo(lavoro(gestore, cancellaRiga), NIENTE_DA_FARE, attesaMassima);
}

async function lavoro(
  gestore: GestoreDelleIscrizioni,
  cancellaRiga?: CancellaRiga,
): Promise<EsitoScollegamento> {
  let iscrizione: IscrizioneDelBrowser | null = null;
  try {
    iscrizione = await gestore.getSubscription();
  } catch {
    return NIENTE_DA_FARE;
  }
  if (!iscrizione) return NIENTE_DA_FARE;

  let rigaCancellata = false;
  if (cancellaRiga) {
    try {
      rigaCancellata = andataBene(await cancellaRiga(iscrizione.endpoint));
    } catch {
      rigaCancellata = false;
    }
  }

  let disiscritto = false;
  try {
    disiscritto = (await iscrizione.unsubscribe()) !== false;
  } catch {
    disiscritto = false;
  }

  return { cera: true, disiscritto, rigaCancellata };
}

/** Il gestore delle iscrizioni di questo browser, se il browser ne ha uno. */
export async function gestoreDiQuestoBrowser(): Promise<GestoreDelleIscrizioni | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    const registrazione = await navigator.serviceWorker.getRegistration();
    return registrazione?.pushManager ?? null;
  } catch {
    return null;
  }
}

/** Scorciatoia per i componenti: lo stesso lavoro, sul browser vero. */
export async function scollegaQuestoDispositivo(
  cancellaRiga?: CancellaRiga,
  attesaMassima: number = ATTESA_MASSIMA,
): Promise<EsitoScollegamento> {
  return conLimiteDiTempo(
    (async () => scollegaPushDaQuestoDispositivo({
      gestore: await gestoreDiQuestoBrowser(),
      cancellaRiga,
      attesaMassima,
    }))(),
    NIENTE_DA_FARE,
    attesaMassima,
  );
}

/**
 * «Notifiche attive» si può scrivere solo se la riga di questo indirizzo è MIA.
 * Il browser da solo non lo sa: risponde di sì anche quando l'iscrizione che
 * custodisce è di chi ha usato l'apparecchio prima di me.
 */
export function notificheAttiveQui({
  endpointDelBrowser,
  endpointMiei,
}: {
  endpointDelBrowser: string | null | undefined;
  endpointMiei: readonly string[];
}): boolean {
  if (!endpointDelBrowser) return false;
  return endpointMiei.includes(endpointDelBrowser);
}

export type EsitoAttivazione<T> =
  | { salvata: true; iscrizione: T; endpointRifatto: boolean }
  | { salvata: false; errore: unknown };

/**
 * Attiva le notifiche per l'utente di adesso.
 *
 * Se l'indirizzo di questo apparecchio è ancora intestato a chi lo ha usato
 * prima, il database rifiuta la scrittura (i permessi per riga non lasciano
 * toccare la riga di un altro). In quel caso non ci si arrende e non si mente:
 * si butta l'iscrizione vecchia — così quell'indirizzo smette di consegnare
 * anche a chi c'era prima — e se ne chiede una nuova, che nasce senza padrone.
 */
export async function attivaPushSuQuestoDispositivo<T extends IscrizioneDelBrowser>({
  creaIscrizione,
  salva,
}: {
  creaIscrizione: () => Promise<T>;
  salva: (iscrizione: T) => PromiseLike<unknown>;
}): Promise<EsitoAttivazione<T>> {
  const prima = await creaIscrizione();
  const esito = await salva(prima);
  if (andataBene(esito)) return { salvata: true, iscrizione: prima, endpointRifatto: false };

  try {
    await prima.unsubscribe();
  } catch {
    /* se non si spegne non importa: quello che conta è ottenerne uno nuovo */
  }
  const seconda = await creaIscrizione();
  const esitoDue = await salva(seconda);
  if (andataBene(esitoDue)) return { salvata: true, iscrizione: seconda, endpointRifatto: true };
  return { salvata: false, errore: (esitoDue as { error?: unknown })?.error ?? esitoDue };
}
