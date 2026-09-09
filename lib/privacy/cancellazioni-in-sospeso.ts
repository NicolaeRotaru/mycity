/**
 * QUANDO UNA CANCELLAZIONE ANCORA APERTA È UN GUASTO — E QUANDO È LA REGOLA CHE FUNZIONA.
 *
 * 8/9/2026 — DUE SENSORI SULLO STESSO FATTO, CON DUE IDEE DIVERSE DI «NON ESEGUITA».
 *
 * Il 3/9 sono nati lo stesso giorno due controlli sulle richieste di
 * cancellazione account, a tre file di distanza, e non si conoscevano:
 *
 *  ① IL GIRO NOTTURNO (`lib/cron-cancellazioni.ts`) dice che il fattorino con la
 *    cassa contanti ancora aperta è un RINVIO DECISO DA NOI, e non deve svegliare
 *    nessuno. Il ragionamento è scritto lì per esteso: «UN fattorino con la cassa
 *    aperta renderebbe rosso il giro TUTTE LE NOTTI». La cancellazione si ferma
 *    apposta prima di distruggere il registro di un debito (art. 17.3 GDPR).
 *
 *  ② IL SORVEGLIANTE (`app/api/cron/operational-alerts/route.ts`) guardava
 *    `profiles.deletion_requested_at` più vecchio di nove giorni e suonava, senza
 *    nessuna esclusione, con la frase «Il giro notturno non le ha cancellate: o
 *    fallisce, o non gira».
 *
 * Per lo STESSO fattorino, ogni giorno, uno dei due mentiva. E mentiva quello che
 * parla: il giro girava, la regola funzionava, e agli amministratori arrivava un
 * avviso al giorno che diceva due cose false. Per un fattorino che non versa mai
 * — il caso proprio previsto — non si spegneva mai. Un allarme sempre acceso su
 * una casella GDPR è peggio di nessun allarme: il giorno che si accende per un
 * guasto vero è indistinguibile dal rumore di ieri.
 *
 * ── LA REGOLA, IN UN POSTO SOLO ─────────────────────────────────────────────
 *
 * Qui sta la definizione condivisa che mancava: «non eseguita» vuol dire ancora
 * qui SENZA una ragione che abbiamo deciso noi. La cassa aperta è l'unica
 * ragione che conosciamo, ed è la stessa riga che usa
 * `contantiAncoraDaVersare` in `lib/account/cancellazione.ts` — le due sono
 * tenute allineate da una prova che le esegue entrambe sugli stessi casi
 * (`tests/unit/il-sorvegliante-non-suona-per-un-rinvio-che-abbiamo-deciso-noi.test.ts`).
 *
 * ── IL VERSO IN CUI SBAGLIARE ───────────────────────────────────────────────
 *
 * Se il registro della cassa NON SI LEGGE, non si esclude nessuno. Una cassa
 * illeggibile non è un rinvio deciso da noi: è un guasto, e un guasto non ha il
 * permesso di spegnere un allarme. È lo stesso errore già riparato l'8/9 dentro
 * `cancellazione.ts`, dove un permesso negato su `cod_reconciliations` faceva
 * passare TUTTE le cancellazioni per «rinvio legittimo».
 *
 * 🟢 Pura: nessuna rete, nessun orologio (l'ora si passa). Una prova la ESEGUE.
 */

/** Una richiesta di cancellazione ancora aperta, come esce da `profiles`. */
export type RichiestaInSospeso = {
  /** `null` quando la riga non porta l'id: non si può accoppiare a una cassa. */
  userId: string | null;
  chiestaIl: string;
};

/** Una giornata di cassa contanti, come esce da `cod_reconciliations`. */
export type GiornataDiCassa = {
  riderId: string;
  remittedAt: string | null;
  collectedCents: number | null;
  status: string | null;
};

/** Il registro della cassa — oppure il fatto che non lo si è potuto leggere. */
export type LetturaCassa =
  | { letta: true; giornate: GiornataDiCassa[] }
  | { letta: false; perche: string };

export type SorveglianzaCancellazioni = {
  /** Chi è ancora qui senza una ragione nostra: qui si sveglia qualcuno. */
  daSegnalare: RichiestaInSospeso[];
  /** Chi è ancora qui perché NOI abbiamo deciso di rinviare (cassa aperta). */
  rinviate: RichiestaInSospeso[];
  /** Giorni di attesa della più vecchia fra quelle da segnalare. */
  giorniDellaPiuVecchia: number | null;
  /** La frase dell'avviso, o `null` quando non c'è niente da dire. */
  riga: string | null;
};

/**
 * Una giornata di cassa è APERTA quando i contanti non risultano versati e o c'è
 * del denaro incassato o la giornata non quadra (un ammanco da chiarire).
 *
 * ⚠️ Questa riga esiste identica in `contantiAncoraDaVersare`
 * (`lib/account/cancellazione.ts`). Non è una copia dimenticata: quel file è di
 * un'altra squadra in questo lotto e non si può toccare. La prova le esegue
 * tutte e due sugli stessi otto casi e fallisce il giorno in cui una delle due
 * cambia da sola — finché non diventano una sola funzione.
 */
export function giornataDiCassaAperta(g: GiornataDiCassa): boolean {
  return g.remittedAt == null && ((g.collectedCents ?? 0) > 0 || g.status === 'MISMATCH');
}

/** Chi ha ancora contanti nostri in mano, fra le persone in attesa di cancellazione. */
export function riderConCassaAperta(giornate: GiornataDiCassa[]): Set<string> {
  const aperti = new Set<string>();
  for (const g of giornate) if (giornataDiCassaAperta(g)) aperti.add(g.riderId);
  return aperti;
}

/** Da quanti giorni una persona sta aspettando. `null` se la data non si legge. */
function giorniDaLaRichiesta(chiestaIl: string, adessoMs: number): number | null {
  const quando = new Date(chiestaIl).getTime();
  if (!Number.isFinite(quando)) return null;
  return Math.floor((adessoMs - quando) / 86_400_000);
}

/**
 * Il verdetto del sorvegliante sulle cancellazioni rimaste aperte.
 *
 * Sta qui e non dentro la rotta perché la parte che conta è una decisione — «si
 * suona o no» — e una decisione dentro una rotta si può provare solo con un
 * finto database intero. Qui si prova con una chiamata.
 */
export function sorvegliaCancellazioni(
  inSospeso: RichiestaInSospeso[],
  cassa: LetturaCassa,
  adessoMs: number,
): SorveglianzaCancellazioni {
  // Cassa illeggibile = nessuna esclusione. Vedi «IL VERSO IN CUI SBAGLIARE».
  const conCassaAperta = cassa.letta ? riderConCassaAperta(cassa.giornate) : new Set<string>();

  const daSegnalare: RichiestaInSospeso[] = [];
  const rinviate: RichiestaInSospeso[] = [];
  for (const r of inSospeso) {
    if (r.userId !== null && conCassaAperta.has(r.userId)) rinviate.push(r);
    else daSegnalare.push(r);
  }

  if (daSegnalare.length === 0) {
    return { daSegnalare, rinviate, giorniDellaPiuVecchia: null, riga: null };
  }

  const giorni = daSegnalare
    .map((r) => giorniDaLaRichiesta(r.chiestaIl, adessoMs))
    .filter((g): g is number => g !== null);
  const piuVecchia = giorni.length > 0 ? Math.max(...giorni) : null;

  return {
    daSegnalare,
    rinviate,
    giorniDellaPiuVecchia: piuVecchia,
    riga: frase(daSegnalare.length, piuVecchia, rinviate.length, cassa.letta),
  };
}

/**
 * La frase che legge un amministratore, in fretta.
 *
 * Non dice più «o fallisce, o non gira»: erano due ipotesi spacciate per un
 * elenco completo, e per il caso più frequente — il rinvio deciso da noi — erano
 * false tutte e due. Dice quello che sappiamo davvero: quante persone, da
 * quanto, e che nessuna di loro ha una ragione nostra per essere ancora qui.
 */
function frase(
  quante: number,
  giorni: number | null,
  rinviate: number,
  cassaLetta: boolean,
): string {
  const chi =
    quante === 1
      ? '1 persona ha chiesto di cancellare l account ed e ancora qui'
      : `${quante} persone hanno chiesto di cancellare l account e sono ancora qui`;
  const da =
    giorni === null
      ? ' da oltre 9 giorni'
      : ` da ${giorni} ${giorni === 1 ? 'giorno' : 'giorni'} (il ripensamento dura 7)`;

  const pezzi = [`${chi}${da}.`];
  if (cassaLetta) {
    pezzi.push(
      quante === 1
        ? 'Non ha contanti da versare: nessuna nostra regola la sta trattenendo.'
        : 'Nessuna di loro ha contanti da versare: nessuna nostra regola le sta trattenendo.',
    );
    pezzi.push('Guarda gli errori del giro notturno delle cancellazioni.');
  } else {
    // Qui il conto è provvisorio, e va detto: dentro potrebbero esserci rinvii
    // legittimi che non abbiamo potuto riconoscere.
    pezzi.push(
      'La cassa contanti dei fattorini non si e potuta leggere, quindi qui dentro potrebbero esserci anche rinvii decisi da noi.',
    );
    pezzi.push('Prima guarda perche la cassa non si legge.');
  }
  if (rinviate > 0) {
    pezzi.push(
      rinviate === 1
        ? 'Oltre a questa, 1 cancellazione e rinviata apposta: contanti ancora da versare.'
        : `Oltre a queste, ${rinviate} cancellazioni sono rinviate apposta: contanti ancora da versare.`,
    );
  }
  return pezzi.join(' ');
}
