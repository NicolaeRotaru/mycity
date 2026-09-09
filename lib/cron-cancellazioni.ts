/**
 * QUANDO IL GIRO NOTTURNO DELLE CANCELLAZIONI DEVE SVEGLIARE QUALCUNO.
 *
 * 3/9/2026 — IL NUMERO C'ERA E NON LO LEGGEVA NESSUNO.
 *
 * `app/api/cron/process-deletions/route.ts` contava le cancellazioni non
 * riuscite e le restituiva nel corpo della risposta HTTP: `{failed: 3}`. Quella
 * risposta la riceve lo scheduler di Vercel, che guarda il codice di stato e
 * butta via il corpo. Quindi il numero esisteva, era esatto, e non lo leggeva
 * nessun essere umano.
 *
 * Una cancellazione non eseguita non è un errore tecnico: è una richiesta fatta
 * per legge (GDPR art. 17) che non è stata onorata, e il termine per rispondere
 * è di un mese (art. 12.3). Il difetto è rimasto invisibile per mesi proprio
 * perché falliva in silenzio.
 *
 * ── PERCHÉ NON BASTA «ok === false → SVEGLIA» ──
 *
 * Perché ci sono due modi diversi di non cancellare un account, e trattarli
 * uguali rompe l'allarme in tutti e due i sensi:
 *
 *  ① GUASTO — il database ha rifiutato, l'autenticazione ha risposto male, un
 *    guardiano ha bloccato la scrittura. Nessuno se ne accorgerà da solo:
 *    va detto stanotte.
 *
 *  ② RINVIO DECISO DA NOI — il fattorino ha ancora dei contanti da versare, e
 *    la cancellazione si ferma apposta prima di distruggere il registro di un
 *    debito (`lib/account/cancellazione.ts`, motivo `cassa_da_versare`). Questo
 *    non è un guasto: è la regola che funziona. Se facesse suonare l'allarme,
 *    UN fattorino con la cassa aperta renderebbe rosso il giro TUTTE LE NOTTI,
 *    per settimane — e un allarme sempre acceso è un allarme che nessuno
 *    guarda più. Peggio: su questo progetto il battito del lavoro si scrive
 *    solo se la risposta è buona (`withCronAuth`), quindi un rinvio legittimo
 *    farebbe anche annunciare «process-deletions è fermo» mentre gira
 *    benissimo. Due allarmi falsi al prezzo di uno.
 *
 * Il rinvio però non può nemmeno durare per sempre: dopo un mese dalla
 * richiesta il termine di legge è scaduto, e allora anche il rinvio diventa una
 * cosa da guardare.
 */

import { recapitoPrivacy } from '@/lib/legal/titolare';

/** Un tentativo di cancellazione, come esce dal giro notturno. */
export type TentativoCancellazione = {
  userId: string;
  ok: boolean;
  /** Presente quando NON si è fatto per una regola nostra, non per un guasto. */
  motivo?: 'cassa_da_versare';
  errore?: string;
  /**
   * Quando la persona ha chiesto di essere cancellata: la RPC
   * `process_expired_deletions` restituisce anche questa data
   * (migrations/040), ed è l'unica cosa che dice da quanto sta aspettando.
   */
  chiestaIl?: string | null;
};

/**
 * I motivi per cui NOI decidiamo di rinviare. Elenco chiuso apposta: un motivo
 * nuovo, aggiunto un domani in `lib/account/cancellazione.ts` senza passare di
 * qui, finisce fra i guasti e fa diventare rossa la notte. È il verso giusto in
 * cui sbagliare — un rinvio sconosciuto trattato come normale sarebbe un
 * silenzio, e il silenzio è il difetto che stiamo chiudendo.
 */
const MOTIVI_DI_RINVIO: readonly string[] = ['cassa_da_versare'];

/**
 * Oltre questo, un rinvio smette di essere una regola che funziona e diventa
 * una richiesta di legge scaduta. Il Regolamento dà un mese per rispondere
 * (art. 12.3): trenta giorni dalla richiesta, non dal primo tentativo.
 */
export const GIORNI_MASSIMI_DI_ATTESA = 30;

export type VerdettoGiro = {
  /** Cancellazioni portate a termine. */
  fatte: number;
  /** Fermate apposta da una regola nostra, ed entro il termine di legge. */
  rinviate: number;
  /** Non riuscite per un guasto. */
  fallite: number;
  /** Rinviate da così tanto che il termine di legge è passato. */
  scadute: number;
  /** Vero quando qualcuno si deve alzare e guardare. */
  daSvegliare: boolean;
  /**
   * La frase che legge una persona, di notte, in fretta. Niente sigle, niente
   * identificativi: quelli stanno nei log, questa è la riga della notifica.
   */
  riga: string | null;
  /**
   * Le risposte dovute alle PERSONE che hanno chiesto di sparire. Vuoto quasi
   * tutte le notti: si riempie solo quando a qualcuno dobbiamo una spiegazione
   * che non ha ancora ricevuto.
   */
  dovuti: AvvisoAllInteressato[];
};

/**
 * Il verdetto della notte.
 *
 * Sta qui, e non dentro la rotta, perché la parte che conta è una decisione —
 * «si sveglia o no» — e una decisione dentro una rotta si può provare solo con
 * un finto database intero. Qui si prova con una chiamata.
 */
export function verdettoDelGiro(
  tentativi: TentativoCancellazione[],
  adessoMs: number,
  recapito: string = recapitoPrivacy().testo,
): VerdettoGiro {
  let fatte = 0;
  let rinviate = 0;
  let fallite = 0;
  let scadute = 0;
  const dovuti: AvvisoAllInteressato[] = [];

  for (const t of tentativi) {
    if (t.ok) {
      fatte++;
      continue;
    }
    const giorni = giorniDaLaRichiesta(t.chiestaIl, adessoMs);
    const fuoriTermine = giorni !== null && giorni > GIORNI_MASSIMI_DI_ATTESA;

    // Guasto è il caso predefinito: si finisce fra i rinvii solo con un motivo
    // che questo file conosce e ha deciso di tollerare.
    if (!t.motivo || !MOTIVI_DI_RINVIO.includes(t.motivo)) {
      fallite++;
      // Un guasto di stanotte alla persona non si annuncia: si sveglia un
      // amministratore e domani si riprova, e quasi sempre domani è già
      // passato. Oltre il mese non è più un inciampo, è il termine di legge
      // scaduto: allora lo deve sapere anche lei, pure se ci stiamo lavorando.
      //
      // La spiegazione la chiede lo STESSO filtro anche di qui, e risponderà
      // `null`. Passare `null` a mano da questo ramo faceva la stessa cosa e
      // lasciava in piedi il modo in cui ci si sbaglia: che cosa si può
      // mostrare a una persona lo decide un posto solo, non chi chiama.
      if (fuoriTermine) {
        dovuti.push(avviso(t, 'termine-scaduto', spiegazionePerLaPersona(t), recapito));
      }
      continue;
    }
    rinviate++;
    if (fuoriTermine) scadute++;
    // Il rinvio si dice SUBITO, la prima notte in cui succede: l'art. 12.3 dice
    // «senza ingiustificato ritardo», non «entro un mese e non un giorno prima».
    const spiegazione = spiegazionePerLaPersona(t);
    dovuti.push(avviso(t, 'rinviata', spiegazione, recapito));
    if (fuoriTermine) dovuti.push(avviso(t, 'termine-scaduto', spiegazione, recapito));
  }

  const daSvegliare = fallite > 0 || scadute > 0;
  return {
    fatte, rinviate, fallite, scadute, daSvegliare, riga: riga(fallite, scadute), dovuti,
  };
}

/** Da quanti giorni una persona sta aspettando. `null` se la data non c'è o non si legge. */
function giorniDaLaRichiesta(chiestaIl: string | null | undefined, adessoMs: number): number | null {
  if (!chiestaIl) return null;
  const quando = new Date(chiestaIl).getTime();
  if (!Number.isFinite(quando)) return null;
  return Math.floor((adessoMs - quando) / 86_400_000);
}

function riga(fallite: number, scadute: number): string | null {
  const pezzi: string[] = [];
  if (fallite > 0) {
    pezzi.push(
      fallite === 1
        ? 'Stanotte 1 richiesta di cancellazione account non è andata a buon fine.'
        : `Stanotte ${fallite} richieste di cancellazione account non sono andate a buon fine.`,
    );
  }
  if (scadute > 0) {
    pezzi.push(
      scadute === 1
        ? `1 persona aspetta la cancellazione da più di ${GIORNI_MASSIMI_DI_ATTESA} giorni: il termine di legge è passato.`
        : `${scadute} persone aspettano la cancellazione da più di ${GIORNI_MASSIMI_DI_ATTESA} giorni: il termine di legge è passato.`,
    );
  }
  if (pezzi.length === 0) return null;
  pezzi.push('Sono richieste fatte per legge: vanno guardate una per una.');
  return pezzi.join(' ');
}

/* ────────────────────────────────────────────────────────────────────────────
 * LE RISPOSTE DOVUTE A CHI ASPETTA.
 *
 * 8/9/2026 — IL RINVIO ERA UN FATTO NOSTRO, NON UNA RISPOSTA A UNA PERSONA.
 *
 * Tutto quello che sta sopra questa riga decide se svegliare NOI. Il fattorino
 * che ha chiesto di sparire, intanto, non riceveva niente: la pagina del suo
 * account gli mostrava un conto alla rovescia che arrivava a «tra 0 giorni» e
 * lì restava, per settimane, senza una riga di spiegazione. La spiegazione
 * esisteva già, scritta in italiano dentro `contantiAncoraDaVersare`, e finiva
 * nei log.
 *
 * Il rinvio in sé è difendibile: l'art. 17.3 permette di conservare per far
 * valere un diritto, e i contanti di altri sono soldi altrui. Quello che manca
 * è l'obbligo che ci sta accanto: l'art. 12.3-12.4 impone di dire
 * all'interessato, senza ingiustificato ritardo e comunque entro un mese, che
 * non stiamo dando seguito alla sua richiesta, per quale motivo, e che può
 * reclamare al Garante. Visto da fuori, un contatore fermo a zero e nessun
 * messaggio è una richiesta di cancellazione ignorata: è la fattispecie con cui
 * si apre un reclamo.
 *
 * ── PERCHÉ UNA CHIAVE, E NON UN «MANDA LA NOTIFICA» ──
 *
 * Perché questo giro passa OGNI NOTTE, e il rinvio dura finché dura la causa.
 * Un avviso per notte vuol dire trenta notifiche identiche a una persona che ha
 * già capito: è lo stesso difetto dell'allarme sempre acceso, girato verso chi
 * sta fuori. Ogni avviso porta quindi una `chiave` che dipende da CHI, da
 * QUANDO ha chiesto e da QUALE tappa: chi lo recapita salta quelli già
 * recapitati, e due notti di fila non producono due messaggi.
 *
 * La data si normalizza in millisecondi apposta: la stessa colonna
 * (`profiles.deletion_requested_at`) arriva qui dalla funzione del database e
 * altrove da una lettura diretta, e due scritture diverse dello stesso istante
 * non devono produrre due chiavi diverse.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Dove mandiamo la persona: la pagina in cui ha chiesto la cancellazione. */
export const PAGINA_DELLE_IMPOSTAZIONI = '/profile/settings';

/**
 * Le due cose che a una persona in attesa dobbiamo dire, e non sono la stessa:
 *
 *  · `rinviata`        — «non l'abbiamo fatta, ecco perché». Si dice subito.
 *  · `termine-scaduto` — «è passato il mese che la legge ci dà». Si dice quando
 *                        passa, e vale anche se il motivo è un guasto nostro.
 */
export type TappaAvviso = 'rinviata' | 'termine-scaduto';

/** Una risposta dovuta a chi ha chiesto di sparire e sta ancora aspettando. */
export type AvvisoAllInteressato = {
  userId: string;
  tappa: TappaAvviso;
  /**
   * La chiave che rende innocuo il ripasso di stanotte: stessa persona, stessa
   * richiesta, stessa tappa → stessa chiave → un avviso solo, per sempre.
   */
  chiave: string;
  titolo: string;
  corpo: string;
  link: string;
};

/**
 * La chiave di un avviso. Dipende da tre cose e da nient'altro, così chi scrive
 * (il giro notturno) e chi legge (la pagina dell'account) la ricavano da soli,
 * senza doversela passare.
 */
export function chiaveAvviso(
  userId: string,
  chiestaIl: string | null | undefined,
  tappa: TappaAvviso,
): string {
  const quando = chiestaIl ? new Date(chiestaIl).getTime() : NaN;
  const parte = Number.isFinite(quando) ? String(quando) : 'senza-data';
  return `cancellazione:${userId}:${parte}:${tappa}`;
}

/**
 * La spiegazione che può leggere la persona — o `null` quando non ne abbiamo
 * una sicura da darle.
 *
 * `errore` è un campo a due facce: per un rinvio deciso da noi porta la frase
 * italiana scritta apposta in `contantiAncoraDaVersare` («risultano 120,00 € di
 * contanti… non ancora versati»); per un guasto porta il messaggio del
 * database, parola per parola. Qui esce SOLO la prima, e non per gentilezza:
 * «permission denied for table cod_reconciliations» dentro la notifica di un
 * fattorino è un pezzo della nostra infrastruttura regalato a chiunque.
 *
 * Il discrimine è lo stesso `motivo` che separa guasto e rinvio, e l'accoppiata
 * è garantita a monte da `MOTIVO_PER_ESITO_CASSA` (lib/account/cancellazione).
 */
function spiegazionePerLaPersona(t: TentativoCancellazione): string | null {
  if (!t.motivo || !MOTIVI_DI_RINVIO.includes(t.motivo)) return null;
  const testo = (t.errore ?? '').trim();
  return testo.length > 0 ? testo : 'Una nostra regola la sta trattenendo.';
}

/** Il testo dell'avviso, come lo legge la persona: niente sigle, niente codici. */
function avviso(
  t: TentativoCancellazione,
  tappa: TappaAvviso,
  spiegazione: string | null,
  recapito: string,
): AvvisoAllInteressato {
  const diritti =
    `Se pensi che non sia giusto scrivi a ${recapito}. ` +
    "Puoi anche presentare un reclamo al Garante per la protezione dei dati personali.";

  const corpo =
    tappa === 'rinviata'
      ? "Hai chiesto di cancellare il tuo account e non l'abbiamo ancora fatto. " +
        `Ti diciamo perché. ${spiegazione ?? "Una nostra regola la sta trattenendo."} ${diritti}`
      : `Hai chiesto di cancellare il tuo account più di ${GIORNI_MASSIMI_DI_ATTESA} giorni fa ` +
        'e non è ancora stato fatto. ' +
        `${spiegazione ?? "Si è fermata per un problema nostro e ci riproviamo ogni notte."} ` +
        'La legge ci dà un mese per risponderti e quel mese è passato. ' +
        diritti;

  return {
    userId: t.userId,
    tappa,
    chiave: chiaveAvviso(t.userId, t.chiestaIl, tappa),
    titolo:
      tappa === 'rinviata'
        ? 'La tua richiesta di cancellazione è in attesa'
        : 'La tua cancellazione è in ritardo',
    corpo,
    link: PAGINA_DELLE_IMPOSTAZIONI,
  };
}
