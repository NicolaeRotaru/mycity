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
 * la regola COM'E' su GitHub e la confronta con quella dei passi in testa a
 * .github/workflows/deploy-dopo-ci.yml, di cui e' l'ultimo passo: se non e'
 * quella, dice in cosa e' diversa e dove si sistema.
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
 *   0  la regola e' quella dei passi in testa a deploy-dopo-ci.yml: accesa,
 *      sul solo «Include default branch», senza rami esclusi, con il solo
 *      controllo «Main». Ferma le richieste con la CI rossa (stampa anche
 *      cosa NON ferma e le scelte rimaste: sono avvisi, non bloccano)
 *   1  di sicuro le manca un pezzo di quella regola (e' spenta, main resta
 *      fuori dai rami che guarda, non pretende il controllo «Main» della CI):
 *      stampa cosa e dove si sistema
 *   2  non ho potuto leggere la regola: non e' un verde, e' un «non lo so»
 *   3  l'ho letta e non le manca niente di sicuro, ma e' diversa da quella
 *      dei passi (altri rami o modelli, rami esclusi per modello, altri
 *      controlli, altre regole): stampa in cosa, e va guardata a mano
 *
 * 16/10/2026 (sesto giro di correzione) — UNA REGOLA SOLA.
 *
 * Qui lo script provava a leggere i rami della regola come li legge GitHub
 * (modelli con * e **, esclusioni, la creazione di rami nuovi) e a dire cosa
 * succedeva sugli altri rami. Ogni lettura in piu' ha fatto nascere una frase
 * sbagliata: otto difetti in due giri. Adesso lo script confronta la regola
 * con quella dei passi, e basta: ✅ solo se e' quella; ❌ solo per un pezzo
 * che manca di sicuro; per tutto il resto ⚪, con in cosa e' diversa.
 *
 * Settimo giro: un ramo incluso o escluso che di sicuro lascia fuori main e'
 * ❌, non ⚪ (l'uscita 3 promette «niente di sicuro»). Le regole in piu' non
 * si nominano: la sigla dell'API, nella pagina di GitHub, non c'e'.
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

/** «Include default branch», come lo scrive GitHub. In questo repository e' main. */
const RAMO_PREDEFINITO = '~DEFAULT_BRANCH';

/** Le voci che la regola «Main» ha dal 26/5: i passi le lasciano come sono. */
const VOCI_DEI_PASSI = new Set(['deletion', 'non_fast_forward', 'required_status_checks']);

/** La frase del ⚪: la regola si guarda a mano, lo script non la interpreta. */
const DIVERSA = 'questa regola e\' diversa da quella della procedura: guardala a mano';

/** Come si chiama un ramo INCLUSO nel menu «Add target» di GitHub. */
function nomeDelRamo(ramo) {
  if (ramo === '~ALL') return '«Include all branches»';
  if (ramo === RAMO_PREDEFINITO) return '«Include default branch»';
  return `«${String(ramo)}»`;
}

function elenco(rami) {
  return rami.map(nomeDelRamo).join(', ');
}

/** Le esclusioni che di sicuro tolgono main, con il loro nome a parole. */
const ESCLUSIONI_DI_MAIN = new Map([
  ['~ALL', 'tutti i rami'],
  [RAMO_PREDEFINITO, 'il ramo predefinito (main)'],
  ['refs/heads/main', '«refs/heads/main»'],
]);

/**
 * Un ramo incluso che di sicuro non e' main: un nome scritto per intero, senza
 * i caratteri dei modelli, che non contiene nemmeno «main». Nel dubbio no: chi
 * non e' sicuro resta una differenza da guardare a mano.
 */
function diSicuroNonEMain(ramo) {
  return typeof ramo === 'string' && !ramo.startsWith('~') && !/[*?[\]{}\\!]/.test(ramo) && !ramo.toLowerCase().includes('main');
}

/** I controlli pretesi da una voce «required_status_checks», sempre come elenco. */
function controlliDi(voce) {
  const controlli = voce?.parameters?.required_status_checks;
  return Array.isArray(controlli) ? controlli : [];
}

/**
 * La valutazione. Funzione pura: riceve la regola come la restituisce l'API di
 * GitHub, non tocca niente.
 *
 * `mancano` sono i pezzi della regola dei passi che di sicuro non ci sono;
 * `diverse` sono le differenze dalla regola dei passi che lo script non
 * giudica: con una voce li', `protegge` e' falso, ma non e' un «non protegge»
 * certo. Gli avvisi descrivono una regola che funziona, quindi ci sono solo
 * col ✅.
 *
 * @returns {{ letta: boolean, protegge: boolean, ramoAggiornato: boolean | null, mancano: {cosa: string, come: string}[], diverse: {cosa: string, come: string}[], avvisi: string[], motivo?: string }}
 */
export function valutaLaRegolaMain(regola) {
  if (!regola || typeof regola !== 'object' || Array.isArray(regola) || !Array.isArray(regola.rules)) {
    const messaggio = regola && typeof regola === 'object' && typeof regola.message === 'string' ? regola.message : '';
    return {
      letta: false,
      protegge: false,
      ramoAggiornato: null,
      mancano: [],
      diverse: [],
      avvisi: [],
      motivo: messaggio
        ? `GitHub ha risposto «${messaggio}» invece della regola.`
        : 'Quello che mi e\' arrivato non e\' una regola di GitHub (manca l\'elenco «rules»).',
    };
  }

  const mancano = [];
  const diverse = [];

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

  // ② I rami: solo «Include default branch», nessuno escluso. I modelli non si
  // interpretano: ❌ solo quando main di sicuro resta fuori, se no ⚪.
  const include = Array.isArray(regola.conditions?.ref_name?.include) ? regola.conditions.ref_name.include : [];
  const exclude = Array.isArray(regola.conditions?.ref_name?.exclude) ? regola.conditions.ref_name.exclude : [];
  if (regola.target !== 'branch') {
    mancano.push({
      cosa: `non e' una regola sui rami (bersaglio «${regola.target ?? 'non indicato'}»), quindi non guarda il ramo main`,
      come: `la regola da sistemare e' quella sui rami: il ruleset «Main» (id ${ID_DELLA_REGOLA}).`,
    });
  } else {
    if (include.length === 0) {
      mancano.push({
        cosa: 'non guarda nessun ramo (bersagli vuoti)',
        come: 'Target branches → Add target → «Include default branch» (cioe\' main).',
      });
    } else if (include.every(diSicuroNonEMain)) {
      mancano.push({
        cosa: `i rami inclusi sono ${elenco(include)}, e nessuno e' main: non guarda il ramo main`,
        come: 'Target branches → Add target → «Include default branch» (cioe\' main), e togli gli altri.',
      });
    } else if (include.length !== 1 || include[0] !== RAMO_PREDEFINITO) {
      diverse.push({
        cosa: `i rami inclusi sono ${elenco(include)}, e la procedura chiede solo «Include default branch»`,
        come: 'Target branches → lascia solo «Include default branch» (cioe\' main) e togli gli altri.',
      });
    }
    const tolgonoMain = exclude.filter((ramo) => ESCLUSIONI_DI_MAIN.has(ramo));
    const altreEsclusioni = exclude.filter((ramo) => !ESCLUSIONI_DI_MAIN.has(ramo));
    if (tolgonoMain.length > 0) {
      mancano.push({
        cosa: `esclude ${tolgonoMain.map((ramo) => ESCLUSIONI_DI_MAIN.get(ramo)).join(', ')}: non guarda il ramo main`,
        come: 'Target branches → togli i rami esclusi.',
      });
    }
    if (altreEsclusioni.length > 0) {
      diverse.push({
        cosa: `esclude dei rami (${altreEsclusioni.map((ramo) => `«${String(ramo)}»`).join(', ')}), e la procedura non ne esclude nessuno`,
        come: 'Target branches → togli i rami esclusi («Exclude by pattern»).',
      });
    }
  }

  // ③ Il controllo «Main» della CI, e nessun altro.
  const vociDeiControlli = regola.rules.filter((r) => r && r.type === 'required_status_checks');
  const controlli = vociDeiControlli.flatMap(controlliDi);
  const righeMain = controlli.filter((c) => c && c.context === CONTROLLO_RICHIESTO);
  if (righeMain.length === 0) {
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
  const altriControlli = controlli.filter((c) => !(c && c.context === CONTROLLO_RICHIESTO));
  if (altriControlli.length > 0) {
    diverse.push({
      cosa: `pretende anche ${altriControlli.map((c) => `«${String(c?.context)}»`).join(', ')}, e la procedura chiede solo «${CONTROLLO_RICHIESTO}», che aspetta gia' tutti gli altri lavori della CI`,
      come: `In «Require status checks to pass» lascia solo «${CONTROLLO_RICHIESTO}».`,
    });
  }

  // ④ Nessuna voce che i passi non chiedono (per esempio la coda di unione).
  // Non si nomina: l'API la chiama con una sigla che la pagina di GitHub non
  // mostra, e una voce rovinata non ha nemmeno quella.
  if (regola.rules.some((r) => !(r && typeof r === 'object' && VOCI_DEI_PASSI.has(r.type)))) {
    diverse.push({
      cosa: 'ha anche altre regole, che la procedura non chiede',
      come: 'togli le regole che non ti servono. Oltre a «Require status checks to pass», la procedura tiene solo quelle che vietano di cancellare il ramo e le spinte forzate.',
    });
  }

  // La spunta del ramo aggiornato: una SCELTA con un costo, non un pezzo che
  // manca. Senza, la regola ferma lo stesso ogni richiesta rossa.
  const conMain = vociDeiControlli.filter((r) => controlliDi(r).some((c) => c && c.context === CONTROLLO_RICHIESTO));
  const ramoAggiornato =
    conMain.length > 0 ? conMain.some((r) => r.parameters?.strict_required_status_checks_policy === true) : null;

  const protegge = mancano.length === 0 && diverse.length === 0;
  return {
    letta: true,
    protegge,
    ramoAggiornato,
    mancano,
    diverse,
    // Gli avvisi dicono cosa fa una regola accesa sul solo main: scritti accanto
    // a una regola spenta o diversa, sarebbero falsi.
    avvisi: protegge ? avvisiDellaRegola(regola, ramoAggiornato) : [],
  };
}

/** Quello che la regola dei passi, accesa, fa e non fa. */
function avvisiDellaRegola(regola, ramoAggiornato) {
  const avvisi = [];
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
  return avvisi;
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
  const diverse = esito.diverse ?? [];
  const righe = [];
  if (esito.protegge) {
    righe.push(
      '✅ La regola «Main» e\' quella della procedura e ferma le richieste con la CI rossa: e\' accesa, guarda solo main e pretende il controllo «Main» verde.',
    );
  } else if (esito.mancano.length > 0) {
    const quante = esito.mancano.length === 1 ? 'C\'e\' una cosa da sistemare' : `Ci sono ${esito.mancano.length} cose da sistemare`;
    righe.push(`❌ La regola «Main» non e' quella della procedura. ${quante}:`);
    esito.mancano.forEach((m, i) => {
      righe.push(`   ${i + 1}. ${m.cosa}.`);
      righe.push(`      Dove si sistema: ${m.come}`);
    });
    if (diverse.length > 0) righe.push(`   ⚪ In piu', ${DIVERSA}. Ecco in cosa:`);
  } else {
    righe.push(`⚪ Ho letto la regola «Main», ma ${DIVERSA}. Ecco in cosa:`);
  }
  for (const d of diverse) {
    righe.push(`   · ${d.cosa}.`);
    righe.push(`      Dove si sistema: ${d.come}`);
  }
  for (const avviso of esito.avvisi) righe.push(`   ⚠️  Da sapere: ${avviso}`);
  return righe;
}

/**
 * L'uscita del comando: 0 e' la regola dei passi; 1 di sicuro le manca un
 * pezzo; 2 non ho letto la regola; 3 l'ho letta, e' diversa dalla regola dei
 * passi e non le manca niente di sicuro: va guardata a mano.
 */
export function uscitaDelVerdetto(esito) {
  if (!esito.letta) return 2;
  if (esito.protegge) return 0;
  return esito.mancano.length > 0 ? 1 : 3;
}

/**
 * Dal testo arrivato (dal file o da `gh api`) all'esito. Funzione pura: un
 * ingresso vuoto o che non e' JSON e' un «non lo so», mai un verde, e dice
 * perche' — vuoto di solito vuol dire che `gh` ha fallito e ha scritto il suo
 * errore sopra, non su di me.
 */
export function esitoDalTesto(testo) {
  const vuoti = { letta: false, protegge: false, ramoAggiornato: null, mancano: [], diverse: [], avvisi: [] };
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
  process.exit(uscitaDelVerdetto(esito));
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
