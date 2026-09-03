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
): VerdettoGiro {
  let fatte = 0;
  let rinviate = 0;
  let fallite = 0;
  let scadute = 0;

  for (const t of tentativi) {
    if (t.ok) {
      fatte++;
      continue;
    }
    // Guasto è il caso predefinito: si finisce fra i rinvii solo con un motivo
    // che questo file conosce e ha deciso di tollerare.
    if (!t.motivo || !MOTIVI_DI_RINVIO.includes(t.motivo)) {
      fallite++;
      continue;
    }
    rinviate++;
    const giorni = giorniDaLaRichiesta(t.chiestaIl, adessoMs);
    if (giorni !== null && giorni > GIORNI_MASSIMI_DI_ATTESA) scadute++;
  }

  const daSvegliare = fallite > 0 || scadute > 0;
  return { fatte, rinviate, fallite, scadute, daSvegliare, riga: riga(fallite, scadute) };
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
