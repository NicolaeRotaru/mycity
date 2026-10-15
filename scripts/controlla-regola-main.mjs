#!/usr/bin/env node
/**
 * controlla-regola-main — dice se la regola «Main» di GitHub ferma le richieste
 * di unione con la CI rossa, prima che entrino in `main`.
 *
 * PERCHE' ESISTE (15/10/2026, R57 e K45).
 *
 * Su GitHub c'e' una regola chiamata «Main» (Settings → Rules → Rulesets, id
 * 16879481), creata il 26/5. E' spenta, non guarda nessun ramo e pretende un
 * controllo di nome «Main» che fino al 15/10 nessun lavoro della CI produceva.
 * Adesso il controllo esiste (l'ultimo lavoro di ci.yml). Questo script legge
 * la regola COM'E' su GitHub e dice, una per una, le cose che le mancano e
 * dove si sistemano. E' il passo finale delle istruzioni in testa a
 * .github/workflows/deploy-dopo-ci.yml.
 *
 * COSA FERMA LA REGOLA, E COSA NO. Il giro precedente qui raccontava il 1/9
 * come una richiesta verde unita sopra un main cambiato. Era falso (collaudo
 * del 15/10, che ha rigiocato quel giorno):
 *
 *   · la #245 toccava solo Button.tsx, Modal.tsx e package-lock.json;
 *   · alle 18:10 si e' unita; la CI di main (corsa 33542096803) e' finita
 *     rossa alle 18:11:32 sulla prova 23-l-attivita-dal-vivo-non-conta-gli-
 *     ordini, che si rompeva da sola nei minuti :10 e :11 di ogni ora
 *     (riparata nel commit 94e56c6 alle 20:19 dello stesso giorno);
 *   · Vercel ha pubblicato quell'unione in produzione nello stesso secondo.
 *
 * Il codice era sano, il rosso veniva dalla prova. Nessuna regola sulle
 * richieste l'avrebbe fermato: la #245 era verde, e anche aggiornata con main
 * avrebbe rifatto la CI a un altro minuto, verde. Un rosso che compare su
 * main DOPO l'unione lo ferma solo il rilascio che aspetta la CI verde di main
 * (deploy-dopo-ci.yml), con "main": false in vercel.json.
 *
 * La regola accesa ferma un'altra cosa, e la ferma tutta: ogni richiesta la
 * cui CI e' rossa resta col pulsante di unione bloccato.
 *
 * LA SPUNTA «Require branches to be up to date before merging» E' UNA SCELTA,
 * non un pezzo che manca. Chiude il caso di due richieste verdi ciascuna da
 * sola che si rompono a vicenda una volta unite (una rinomina una funzione che
 * l'altra usa). Costa, dopo ogni unione, un «Update branch» e una CI in piu'
 * (4-5 minuti) per ogni richiesta ancora aperta. Lo script la segnala come
 * scelta, non la pretende. Un caso vero di quel tipo in questo repository non
 * l'ho cercato: il 1/9 non lo e'.
 *
 * Uso:
 *   gh api repos/NicolaeRotaru/mycity/rulesets/16879481 | node scripts/controlla-regola-main.mjs
 *   (oppure con il JSON salvato in un file: node scripts/controlla-regola-main.mjs regola.json)
 *
 * Uscita:
 *   0  la regola ferma le richieste con la CI rossa (stampa anche cosa NON
 *      ferma e le scelte rimaste: sono avvisi, non bloccano)
 *   1  non le ferma: stampa cosa manca e dove si sistema
 *   2  non ho potuto leggere la regola: non e' un verde, e' un «non lo so»
 */
import fs from 'node:fs';
import tty from 'node:tty';
import { fileURLToPath } from 'node:url';

/** Il nome del controllo che la regola pretende: e' il lavoro finale di ci.yml. */
export const CONTROLLO_RICHIESTO = 'Main';

/** La regola vera, su GitHub. */
export const ID_DELLA_REGOLA = 16879481;

/** L'app «GitHub Actions»: e' lei a pubblicare i controlli dei lavori della CI. */
const APP_GITHUB_ACTIONS = 15368;

/** I bersagli che, in una regola di GitHub, comprendono il ramo main. */
const BERSAGLI_CHE_COPRONO_MAIN = new Set(['~DEFAULT_BRANCH', '~ALL', 'refs/heads/main']);

/**
 * La valutazione. Funzione pura: riceve la regola come la restituisce l'API di
 * GitHub, non tocca niente.
 *
 * @returns {{ letta: boolean, protegge: boolean, ramoAggiornato: boolean | null, mancano: {cosa: string, come: string}[], avvisi: string[], motivo?: string }}
 */
export function valutaLaRegolaMain(regola) {
  if (!regola || typeof regola !== 'object' || Array.isArray(regola) || !Array.isArray(regola.rules)) {
    const messaggio = regola && typeof regola === 'object' && typeof regola.message === 'string' ? regola.message : '';
    return {
      letta: false,
      protegge: false,
      ramoAggiornato: null,
      mancano: [],
      avvisi: [],
      motivo: messaggio
        ? `GitHub ha risposto «${messaggio}» invece della regola.`
        : 'Quello che mi e\' arrivato non e\' una regola di GitHub (manca l\'elenco «rules»).',
    };
  }

  const mancano = [];
  const avvisi = [];

  // ① Accesa davvero. «Evaluate» registra cosa avrebbe bloccato, ma non blocca.
  if (regola.enforcement !== 'active') {
    mancano.push({
      cosa:
        regola.enforcement === 'evaluate'
          ? 'e\' in prova («Evaluate»): registra cosa avrebbe fermato, ma non ferma niente'
          : `e' spenta (enforcement «${regola.enforcement ?? 'non indicato'}»)`,
      come: 'Enforcement status → «Active», poi Save changes.',
    });
  }

  // ② Guarda il ramo main.
  const include = Array.isArray(regola.conditions?.ref_name?.include) ? regola.conditions.ref_name.include : [];
  const exclude = Array.isArray(regola.conditions?.ref_name?.exclude) ? regola.conditions.ref_name.exclude : [];
  const guardaMain =
    regola.target === 'branch' &&
    include.some((b) => BERSAGLI_CHE_COPRONO_MAIN.has(b)) &&
    !exclude.some((b) => BERSAGLI_CHE_COPRONO_MAIN.has(b));
  if (!guardaMain) {
    mancano.push({
      cosa: include.length === 0 ? 'non guarda nessun ramo (bersagli vuoti)' : 'non guarda il ramo main',
      come: 'Target branches → Add target → «Include default branch» (cioe\' main).',
    });
  }

  // ③ Pretende il controllo «Main», pubblicato da GitHub Actions.
  const regoleDeiControlli = regola.rules.filter((r) => r && r.type === 'required_status_checks');
  const conMain = regoleDeiControlli.filter((r) =>
    (r.parameters?.required_status_checks ?? []).some((c) => c && c.context === CONTROLLO_RICHIESTO),
  );
  const righeMain = conMain.flatMap((r) =>
    (r.parameters?.required_status_checks ?? []).filter((c) => c && c.context === CONTROLLO_RICHIESTO),
  );
  if (conMain.length === 0) {
    mancano.push({
      cosa: `non pretende il controllo «${CONTROLLO_RICHIESTO}»`,
      come: `Spunta «Require status checks to pass» → Add checks → scrivi «${CONTROLLO_RICHIESTO}» (e' il lavoro finale della CI, aspetta tutti gli altri).`,
    });
  } else if (righeMain.every((c) => c.integration_id != null && c.integration_id !== APP_GITHUB_ACTIONS)) {
    mancano.push({
      cosa: `pretende «${CONTROLLO_RICHIESTO}» da un'app che non e' GitHub Actions: il controllo della CI non varrebbe e nessuna unione passerebbe`,
      come: `Nella riga del controllo «${CONTROLLO_RICHIESTO}», come fonte scegli «GitHub Actions» oppure «Any source».`,
    });
  }

  // ④ La coda di unione («Require merge queue»). Con la coda, GitHub aspetta i
  // controlli anche sull'evento merge_group, e ci.yml non gira su merge_group:
  // «Main» non arriverebbe mai e ogni unione resterebbe ferma in coda.
  if (regola.rules.some((r) => r && r.type === 'merge_queue')) {
    mancano.push({
      cosa:
        'chiede la coda di unione, ma la CI non gira sull\'evento merge_group: in coda il controllo «Main» non arriverebbe mai e nessuna unione passerebbe',
      come: 'Togli «Require merge queue» dalla regola (oppure, prima, aggiungi merge_group fra gli eventi di .github/workflows/ci.yml).',
    });
  }

  // La spunta del ramo aggiornato: una SCELTA con un costo, non un pezzo che
  // manca. Senza, la regola ferma lo stesso ogni richiesta rossa.
  const ramoAggiornato =
    conMain.length > 0 ? conMain.some((r) => r.parameters?.strict_required_status_checks_policy === true) : null;
  if (ramoAggiornato === false) {
    avvisi.push(
      'la spunta «Require branches to be up to date before merging» e\' tolta, ed e\' una scelta tua. Senza, due richieste verdi ciascuna da sola possono rompersi a vicenda una volta unite, e se ne accorge solo la CI di main, dopo. ' +
        'Con la spunta non succede, ma dopo ogni unione ogni altra richiesta aperta va aggiornata («Update branch») e la CI rigira, 4-5 minuti ciascuna.',
    );
  } else if (ramoAggiornato === true) {
    avvisi.push(
      'la spunta «Require branches to be up to date before merging» e\' messa: dopo ogni unione le altre richieste aperte vanno aggiornate («Update branch») e la CI rigira, 4-5 minuti ciascuna.',
    );
  }

  // Quello che nessuna regola sulle richieste ferma, scritto ogni volta perche'
  // un ✅ qui non venga letto come «il codice rosso non arriva piu' ai clienti».
  avvisi.push(
    'non ferma un rosso che compare su main DOPO l\'unione: una prova che si rompe da sola (il 1/9 la CI di main e\' finita rossa alle 18:11 per una prova legata all\'ora, e Vercel ha pubblicato lo stesso), ' +
      'o due richieste che si pestano i piedi. Quello lo ferma il rilascio dopo CI verde: i segreti di Vercel su GitHub, poi "main": false in vercel.json.',
  );

  // Altri controlli richiesti: non sbagliati di per se', ma un nome che nessun
  // lavoro produce blocca ogni unione per sempre («Expected — Waiting»).
  const altri = regoleDeiControlli
    .flatMap((r) => r.parameters?.required_status_checks ?? [])
    .map((c) => c?.context)
    .filter((nome) => typeof nome === 'string' && nome !== CONTROLLO_RICHIESTO);
  if (altri.length > 0) {
    avvisi.push(
      `pretende anche ${altri.map((n) => `«${n}»`).join(', ')}: ogni nome deve essere identico a quello di un lavoro della CI, altrimenti nessuna unione passera' mai. «${CONTROLLO_RICHIESTO}» da solo li copre gia' tutti.`,
    );
  }

  // Chi puo' scavalcarla. GitHub mostra l'elenco solo a chi puo' modificare la regola.
  if (!Array.isArray(regola.bypass_actors)) {
    avvisi.push('non vedo chi puo\' scavalcarla: GitHub mostra quell\'elenco solo a chi puo\' modificare la regola.');
  } else if (regola.bypass_actors.length === 0) {
    avvisi.push(
      'nessuno puo\' scavalcarla, nemmeno tu: con la CI rossa non si unisce e non si spinge su main, neanche in un\'emergenza. Se vuoi una porta per le emergenze, aggiungiti in «Bypass list».',
    );
  } else {
    avvisi.push(
      `${regola.bypass_actors.length} fra persone, squadre o app possono scavalcarla: quando lo fanno, il codice rosso entra lo stesso.`,
    );
  }

  return { letta: true, protegge: mancano.length === 0, ramoAggiornato, mancano, avvisi };
}

/** Le righe da stampare per un esito. */
export function righeDelVerdetto(esito) {
  if (!esito.letta) {
    return [
      '⚪ Non ho potuto leggere la regola «Main», quindi non so se protegge main.',
      `   ${esito.motivo}`,
      `   Leggila cosi': gh api repos/NicolaeRotaru/mycity/rulesets/${ID_DELLA_REGOLA} | node scripts/controlla-regola-main.mjs`,
      `   oppure salvala e passami il file: gh api repos/NicolaeRotaru/mycity/rulesets/${ID_DELLA_REGOLA} > regola.json && node scripts/controlla-regola-main.mjs regola.json`,
    ];
  }
  const righe = esito.protegge
    ? ['✅ La regola «Main» ferma le richieste con la CI rossa: e\' accesa, guarda main e pretende il controllo «Main» verde.']
    : [`❌ La regola «Main» NON ferma le richieste con la CI rossa. Le mancano ${esito.mancano.length} cose:`];
  esito.mancano.forEach((m, i) => {
    righe.push(`   ${i + 1}. ${m.cosa}.`);
    righe.push(`      Dove si sistema: ${m.come}`);
  });
  for (const avviso of esito.avvisi) righe.push(`   ⚠️  Da sapere: ${avviso}`);
  return righe;
}

/**
 * Dal testo arrivato (dal file o da `gh api`) all'esito. Funzione pura: un
 * ingresso vuoto o che non e' JSON e' un «non lo so», mai un verde, e dice
 * perche' — vuoto di solito vuol dire che `gh` ha fallito e ha scritto il suo
 * errore sopra, non su di me.
 */
export function esitoDalTesto(testo) {
  const vuoti = { letta: false, protegge: false, ramoAggiornato: null, mancano: [], avvisi: [] };
  if (String(testo ?? '').trim() === '') {
    return {
      ...vuoti,
      motivo:
        'Non mi e\' arrivato niente. Se qui sopra il comando gh ha scritto un errore, il motivo e\' quello (per esempio «gh auth login» se non sei collegato).',
    };
  }
  let regola;
  try {
    regola = JSON.parse(testo);
  } catch {
    return { ...vuoti, motivo: 'Quello che mi e\' arrivato non e\' JSON: non e\' la risposta di gh api.' };
  }
  return valutaLaRegolaMain(regola);
}

/**
 * 15/10/2026 (collaudo di R57) — L'INGRESSO SI LEGGE COME UN FLUSSO, FINO ALLA FINE.
 *
 * Qui c'era `if (process.stdin.isTTY) return ''; return fs.readFileSync(0)`.
 * Toccare `process.stdin` mette la pipe in modalita' non bloccante, e allora
 * `readFileSync(0)` lancia EAGAIN se chi scrive non ha ancora scritto. `gh api`
 * aspetta la rete prima di scrivere: il comando delle istruzioni,
 * `gh api … | node scripts/controlla-regola-main.mjs`, usciva SEMPRE 2 («non ho
 * potuto leggere la regola»), anche con la regola giusta. Le prove passavano
 * perche' consegnavano tutto l'ingresso prima che node leggesse.
 *
 * Adesso: se l'ingresso e' un terminale (nessuno ha passato niente) lo si
 * chiede a `tty.isatty`, che non tocca `process.stdin`; altrimenti si legge il
 * flusso pezzo per pezzo, aspettando chi scrive, fino a che lo chiude.
 */
async function leggiIngresso() {
  const file = process.argv[2];
  if (file) return fs.readFileSync(file, 'utf8');
  if (tty.isatty(0)) return '';
  const pezzi = [];
  for await (const pezzo of process.stdin) pezzi.push(Buffer.isBuffer(pezzo) ? pezzo : Buffer.from(pezzo));
  return Buffer.concat(pezzi).toString('utf8');
}

async function main() {
  const esito = esitoDalTesto(await leggiIngresso());
  for (const riga of righeDelVerdetto(esito)) console.log(riga);
  process.exit(!esito.letta ? 2 : esito.protegge ? 0 : 1);
}

// Si parte solo quando il file e' lanciato da riga di comando (le prove lo
// importano). Si confrontano i percorsi veri, risolti i collegamenti simbolici
// da tutte e due le parti: confrontare il percorso scritto con quello vero
// faceva uscire 0 in silenzio chi lanciava da un collegamento.
function lanciatoDaRigaDiComando() {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (lanciatoDaRigaDiComando()) {
  main().catch((errore) => {
    console.log('⚪ Non ho potuto leggere la regola «Main», quindi non so se protegge main.');
    console.log(`   ${errore instanceof Error ? errore.message : String(errore)}`);
    process.exit(2);
  });
}
