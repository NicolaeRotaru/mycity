#!/usr/bin/env node
/**
 * controlla-regola-main — dice se la regola «Main» di GitHub ferma davvero il
 * codice rosso prima che entri in `main` (e quindi in produzione).
 *
 * PERCHE' ESISTE (15/10/2026, collaudo di R57 e K45).
 *
 * Su GitHub c'e' una regola chiamata «Main» (Settings → Rules → Rulesets, id
 * 16879481) che pretende il controllo «Main» verde prima di unire. Il primo
 * giro di riparazione diceva a Nicola di accenderla, puntarla su main e
 * lasciare «Require status checks to pass». Il collaudo ha ricostruito
 * l'incidente vero del 1/9 e ha mostrato che cosi' NON lo ferma:
 *
 *   · la richiesta #245 aveva la CI verde alle 14:33 (corsa 33520192457);
 *   · alle 15:05 e' entrata in main la #246 (31 commit);
 *   · alle 18:10 si e' unita la #245, ferma al main di prima: il risultato
 *     dell'unione (2185736) e' finito ROSSO — «Controlli database», corsa
 *     33542096803 — e Vercel l'ha pubblicato in produzione.
 *
 * Due richieste verdi da sole, un'unione rossa. Una regola che guarda solo «il
 * controllo e' verde?» la lascia passare, perche' il controllo verde c'era. Per
 * fermarla serve anche la spunta «Require branches to be up to date before
 * merging»: la richiesta deve contenere il main di adesso, e quindi la CI
 * rigira proprio sul codice che entrera'.
 *
 * Questo script legge la regola COM'E' su GitHub e dice, una per una, le cose
 * che le mancano per fermare quel giorno, e come si sistemano. E' il passo
 * finale delle istruzioni in testa a .github/workflows/deploy-dopo-ci.yml.
 *
 * Uso:
 *   gh api repos/NicolaeRotaru/mycity/rulesets/16879481 | node scripts/controlla-regola-main.mjs
 *   (oppure con il JSON salvato in un file: node scripts/controlla-regola-main.mjs regola.json)
 *
 * Uscita:
 *   0  la regola ferma il codice rosso (puo' stampare avvisi, che non bloccano)
 *   1  non lo ferma: stampa cosa manca e dove si sistema
 *   2  non ho potuto leggere la regola: non e' un verde, e' un «non lo so»
 */
import fs from 'node:fs';
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
 * @returns {{ letta: boolean, protegge: boolean, mancano: {cosa: string, come: string}[], avvisi: string[], motivo?: string }}
 */
export function valutaLaRegolaMain(regola) {
  if (!regola || typeof regola !== 'object' || Array.isArray(regola) || !Array.isArray(regola.rules)) {
    const messaggio = regola && typeof regola === 'object' && typeof regola.message === 'string' ? regola.message : '';
    return {
      letta: false,
      protegge: false,
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

  // ④ Il ramo aggiornato con main: e' la clausola che ferma il 1/9.
  if (conMain.length > 0) {
    const aggiornato = conMain.some((r) => r.parameters?.strict_required_status_checks_policy === true);
    if (!aggiornato) {
      const coda = regola.rules.some((r) => r && r.type === 'merge_queue');
      mancano.push({
        cosa:
          'non pretende che la richiesta sia aggiornata con main: una richiesta verde da sola puo\' unirsi sopra un main cambiato nel frattempo. ' +
          'E\' cosi\' che il 1/9 la #245 (CI verde alle 14:33) si e\' unita dopo la #246 ed e\' andata in produzione rossa',
        come:
          'Sotto «Require status checks to pass» spunta «Require branches to be up to date before merging».' +
          (coda
            ? ' La coda di unione da sola non basta: vorrebbe il controllo anche sull\'evento merge_group, e ci.yml oggi non gira su merge_group, quindi «Main» non arriverebbe mai.'
            : ''),
      });
    }
  }

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

  return { letta: true, protegge: mancano.length === 0, mancano, avvisi };
}

/** Le righe da stampare per un esito. */
export function righeDelVerdetto(esito) {
  if (!esito.letta) {
    return [
      '⚪ Non ho potuto leggere la regola «Main», quindi non so se protegge main.',
      `   ${esito.motivo}`,
      `   Leggila cosi': gh api repos/NicolaeRotaru/mycity/rulesets/${ID_DELLA_REGOLA} | node scripts/controlla-regola-main.mjs`,
    ];
  }
  const righe = esito.protegge
    ? ['✅ La regola «Main» ferma il codice rosso: e\' accesa, guarda main, pretende «Main» verde e la richiesta aggiornata con main.']
    : [`❌ La regola «Main» NON ferma il codice rosso. Le mancano ${esito.mancano.length} cose:`];
  esito.mancano.forEach((m, i) => {
    righe.push(`   ${i + 1}. ${m.cosa}.`);
    righe.push(`      Dove si sistema: ${m.come}`);
  });
  for (const avviso of esito.avvisi) righe.push(`   ⚠️  Da sapere: ${avviso}`);
  return righe;
}

function leggiIngresso() {
  const file = process.argv[2];
  if (file) return fs.readFileSync(file, 'utf8');
  if (process.stdin.isTTY) return '';
  return fs.readFileSync(0, 'utf8');
}

function main() {
  let regola = null;
  try {
    regola = JSON.parse(leggiIngresso());
  } catch {
    regola = null;
  }
  const esito = valutaLaRegolaMain(regola);
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

if (lanciatoDaRigaDiComando()) main();
