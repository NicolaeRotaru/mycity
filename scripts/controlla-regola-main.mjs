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
 *   1  non le ferma, oppure le ferma ma guarda anche altri rami oltre a main
 *      (e li' blocca le spinte): stampa cosa manca e dove si sistema
 *   2  non ho potuto leggere la regola: non e' un verde, e' un «non lo so»
 *   3  ho letto la regola, ma un modello dei rami (per esempio con [ ] o
 *      «refs/heads/**\/main») non so come GitHub lo legge: non e' un verde,
 *      va controllata a mano
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

/** Il ramo main come lo scrive GitHub. In questo repository «Include default branch» e' lui. */
const RAMO_MAIN = 'refs/heads/main';

/** Ogni ramo, per GitHub, comincia cosi'. */
const PREFISSO_DEI_RAMI = 'refs/heads/';

/*
 * 16/10/2026 (correzione del lotto) — I RAMI DI UNA REGOLA SONO MODELLI, NON NOMI.
 *
 * Prima lo script confrontava i rami inclusi ed esclusi per nome esatto. Su
 * GitHub invece sono modelli: «refs/heads/*», «refs/heads/**» e «refs/heads/m*»
 * comprendono anche main. Un'esclusione «refs/heads/*» scritta per sbaglio
 * lasciava fuori main, e lo script diceva ✅ con uscita 0.
 *
 * La documentazione di GitHub dice fnmatch di Ruby con FNM_PATHNAME: `*` e `?`
 * non attraversano «/», e `**` seguito da «/» vale «zero o piu' cartelle». Non
 * dice se le maiuscole contano, e molti leggono `**` come «qualunque cosa,
 * anche le «/»». Allora ogni modello si prova con tutte queste letture: se
 * danno la stessa risposta, quella e' la risposta; se non la danno, lo script
 * dice «non so giudicare» e non da' un verdetto. Le parentesi [ ] { } e la
 * barra \ non le leggo affatto: sono sempre un «non so».
 */
const LETTURE_DEI_MODELLI = [
  { doppiaStellaAttraversa: false, contanoLeMaiuscole: true },
  { doppiaStellaAttraversa: false, contanoLeMaiuscole: false },
  { doppiaStellaAttraversa: true, contanoLeMaiuscole: true },
  { doppiaStellaAttraversa: true, contanoLeMaiuscole: false },
];

/** Un modello che so leggere: comincia con refs/heads/ e usa solo `*`, `**` e `?`. */
function modelloLeggibile(modello) {
  return typeof modello === 'string' && modello.startsWith(PREFISSO_DEI_RAMI) && !/[[\]{}\\]/.test(modello);
}

/** Il modello come espressione regolare. Con `doppiaStellaAttraversa`, `**` prende anche le «/». */
function espressioneDelModello(modello, doppiaStellaAttraversa) {
  let espressione = '';
  for (let i = 0; i < modello.length; ) {
    if (modello[i] === '*') {
      let stelle = 0;
      while (modello[i] === '*') {
        stelle += 1;
        i += 1;
      }
      espressione += stelle >= 2 && doppiaStellaAttraversa ? '.*' : '[^/]*';
    } else if (modello[i] === '?') {
      espressione += '[^/]';
      i += 1;
    } else {
      espressione += modello[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      i += 1;
    }
  }
  return espressione;
}

/** Un pezzo fra due «/», alla Ruby: un nome che comincia col punto lo prende solo un punto scritto. */
function pezzoCorrisponde(pezzoDelModello, pezzoDelNome, lettura) {
  if (pezzoDelNome.startsWith('.') && !pezzoDelModello.startsWith('.')) return false;
  return new RegExp(`^${espressioneDelModello(pezzoDelModello, false)}$`, lettura.contanoLeMaiuscole ? '' : 'i').test(
    pezzoDelNome,
  );
}

/** fnmatch di Ruby con FNM_PATHNAME: un pezzo «**» seguito da «/» prende zero o piu' cartelle. */
function corrispondeAllaRuby(modello, nome, lettura, i = 0, j = 0) {
  if (i === modello.length) return j === nome.length;
  if (modello[i] === '**' && i < modello.length - 1) {
    for (let k = j; k < nome.length; k += 1) {
      if (corrispondeAllaRuby(modello, nome, lettura, i + 1, k)) return true;
      if (nome[k].startsWith('.')) return false;
    }
    return false;
  }
  if (j === nome.length) return false;
  return pezzoCorrisponde(modello[i], nome[j], lettura) && corrispondeAllaRuby(modello, nome, lettura, i + 1, j + 1);
}

function corrisponde(modello, ramo, lettura) {
  if (!lettura.doppiaStellaAttraversa) return corrispondeAllaRuby(modello.split('/'), ramo.split('/'), lettura);
  return new RegExp(`^${espressioneDelModello(modello, true)}$`, lettura.contanoLeMaiuscole ? '' : 'i').test(ramo);
}

/**
 * Il modello comprende il ramo? `true`, `false`, oppure `null` = non lo so
 * (modello che non so leggere, o letture che non vanno d'accordo).
 *
 * @param {unknown} modello  una voce di include o exclude, come la scrive GitHub
 * @param {string} ramo      un ramo intero, per esempio «refs/heads/main»
 * @returns {boolean | null}
 */
export function modelloComprende(modello, ramo) {
  if (modello === '~ALL') return ramo.startsWith(PREFISSO_DEI_RAMI);
  if (modello === '~DEFAULT_BRANCH') return ramo === RAMO_MAIN;
  if (!modelloLeggibile(modello)) return null;
  const risposte = LETTURE_DEI_MODELLI.map((lettura) => corrisponde(modello, ramo, lettura));
  if (risposte.every(Boolean)) return true;
  if (risposte.some(Boolean)) return null;
  return false;
}

/** «Almeno uno lo comprende», con il «non lo so»: un si' certo vince, altrimenti un dubbio resta dubbio. */
function qualcunoComprende(modelli, ramo) {
  const risposte = modelli.map((m) => modelloComprende(m, ramo));
  if (risposte.some((r) => r === true)) return true;
  if (risposte.every((r) => r === false)) return false;
  return null;
}

/** Dei rami di prova che un modello comprende, tutti diversi da main: servono a dire «prende anche altri rami». */
const RAMI_DI_PROVA_DI_TUTTI = ['refs/heads/un-altro-ramo', 'refs/heads/lavoro/un-altro-ramo', 'refs/heads/x'];
const RIEMPITIVI_DELLA_STELLA = ['x', 'un-altro-ramo', ''];
const RIEMPITIVI_DELLA_DOPPIA_STELLA = ['x', 'un-altro-ramo', 'lavoro/un-altro-ramo', ''];

function ramiDiProva(modello) {
  if (modello === '~ALL') return RAMI_DI_PROVA_DI_TUTTI;
  if (!modelloLeggibile(modello)) return [];
  const rami = new Set();
  for (const stella of RIEMPITIVI_DELLA_STELLA) {
    for (const doppia of RIEMPITIVI_DELLA_DOPPIA_STELLA) {
      const ramo = modello.replace(/\*{2,}|\*|\?/g, (t) => (t === '?' ? 'x' : t.length >= 2 ? doppia : stella));
      const pezzi = ramo.slice(PREFISSO_DEI_RAMI.length).split('/');
      const plausibile = ramo.toLowerCase() !== RAMO_MAIN && pezzi.every((p) => p !== '' && !p.startsWith('.'));
      if (plausibile) rami.add(ramo);
    }
  }
  return [...rami];
}

/**
 * Un bersaglio prende anche rami che non sono main, tolte le esclusioni?
 * `true` solo se c'e' un ramo vero che lo dimostra; `false` se le esclusioni
 * lo cancellano di sicuro; `null` quando non lo so dire.
 */
function prendeAltriRami(bersaglio, exclude) {
  if (bersaglio === '~DEFAULT_BRANCH' || bersaglio === RAMO_MAIN) return false;
  if (exclude.includes('~ALL') || exclude.includes(bersaglio)) return false;
  for (const ramo of ramiDiProva(bersaglio)) {
    if (modelloComprende(bersaglio, ramo) === true && qualcunoComprende(exclude, ramo) === false) return true;
  }
  return null;
}

/** Come si chiama un bersaglio nella pagina di GitHub. */
function nomeDelBersaglio(bersaglio) {
  if (bersaglio === '~ALL') return '«All branches»';
  if (bersaglio === '~DEFAULT_BRANCH') return '«Default branch»';
  return `«${String(bersaglio)}»`;
}

function elencoDeiBersagli(bersagli) {
  return bersagli.map(nomeDelBersaglio).join(', ');
}

/**
 * La valutazione. Funzione pura: riceve la regola come la restituisce l'API di
 * GitHub, non tocca niente.
 *
 * `nonSoGiudicare` elenca quello che lo script non sa dire (un modello dei rami
 * che non sa leggere, o che GitHub potrebbe leggere in due modi): con una voce
 * li', `protegge` e' falso, ma non e' un «non protegge» certo.
 *
 * @returns {{ letta: boolean, protegge: boolean, ramoAggiornato: boolean | null, mancano: {cosa: string, come: string, bloccaAltriRami?: boolean}[], nonSoGiudicare: {cosa: string, come: string, suMain?: boolean}[], avvisi: string[], motivo?: string }}
 */
export function valutaLaRegolaMain(regola) {
  if (!regola || typeof regola !== 'object' || Array.isArray(regola) || !Array.isArray(regola.rules)) {
    const messaggio = regola && typeof regola === 'object' && typeof regola.message === 'string' ? regola.message : '';
    return {
      letta: false,
      protegge: false,
      ramoAggiornato: null,
      mancano: [],
      nonSoGiudicare: [],
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

  // Quello che lo script non sa giudicare: mai un verde, mai un ❌ inventato.
  const nonSoGiudicare = [];

  // ② Guarda il ramo main: e' fra i rami inclusi e non e' fra gli esclusi,
  // letti come modelli (vedi LETTURE_DEI_MODELLI).
  const include = Array.isArray(regola.conditions?.ref_name?.include) ? regola.conditions.ref_name.include : [];
  const exclude = Array.isArray(regola.conditions?.ref_name?.exclude) ? regola.conditions.ref_name.exclude : [];
  const suiRami = regola.target === 'branch';
  const mainIncluso = suiRami ? qualcunoComprende(include, RAMO_MAIN) : false;
  const mainEscluso = suiRami ? qualcunoComprende(exclude, RAMO_MAIN) : false;
  if (mainIncluso === false) {
    mancano.push({
      cosa: include.length === 0 ? 'non guarda nessun ramo (bersagli vuoti)' : 'non guarda il ramo main',
      come: 'Target branches → Add target → «Include default branch» (cioe\' main).',
    });
  }
  if (mainEscluso === true) {
    const esclusioni = exclude.filter((b) => modelloComprende(b, RAMO_MAIN) === true);
    const elenco = elencoDeiBersagli(esclusioni);
    mancano.push({
      cosa:
        esclusioni.length === 1
          ? `non guarda il ramo main: fra i rami esclusi c'e' ${elenco}, che comprende anche main`
          : `non guarda il ramo main: fra i rami esclusi ci sono ${elenco}, che comprendono anche main`,
      come: `Target branches → togli ${elenco} dai rami esclusi («Exclude by pattern»).`,
    });
  }
  const mainDubbio = mainIncluso !== false && mainEscluso !== true && (mainIncluso === null || mainEscluso === null);
  if (mainDubbio) {
    const dubbi = [
      ...(mainIncluso === null ? include : []),
      ...(mainEscluso === null ? exclude : []),
    ].filter((b) => modelloComprende(b, RAMO_MAIN) === null);
    nonSoGiudicare.push({
      cosa: `non so dire se la regola guarda il ramo main: non so come GitHub legge ${elencoDeiBersagli(dubbi)}`,
      come:
        'controlla a mano che main sia fra i rami coperti, oppure scrivi i rami in una forma che so leggere: «Include default branch» per main, e per gli altri modelli come refs/heads/claude/** (senza [ ], { } e \\).',
      suMain: true,
    });
  }

  // ②bis Guarda SOLO main (16/10/2026, correzione del lotto). Su GitHub il
  // controllo obbligatorio di una regola vale anche per le spinte: un commit
  // nuovo entra in un ramo coperto solo se ha gia' passato la CI su un altro
  // ramo. Se la regola copre anche altri rami, li' non si spinge piu' niente di
  // nuovo; con «All branches» un altro ramo non c'e' e il lavoro di tutti si
  // ferma. Prima '~ALL' contava come «guarda main» e lo script diceva ✅.
  // Un bersaglio «prende altri rami» solo se c'e' un ramo vero, diverso da
  // main, che lui comprende e nessuna esclusione toglie: le esclusioni contano.
  const regoleDeiControlli = regola.rules.filter((r) => r && r.type === 'required_status_checks');
  // «Do not require status checks on creation»: creare un ramo nuovo resta libero.
  const creazioneLibera =
    regoleDeiControlli.length > 0 && regoleDeiControlli.every((r) => r.parameters?.do_not_enforce_on_create === true);
  const conAltriRami = suiRami ? include.map((b) => ({ bersaglio: b, prende: prendeAltriRami(b, exclude) })) : [];
  const oltreMain = conAltriRami.filter((c) => c.prende === true).map((c) => c.bersaglio);
  const forseOltreMain = conAltriRami.filter((c) => c.prende === null).map((c) => c.bersaglio);
  const esclusiDetti = exclude.length > 0 ? `tolti i rami esclusi ${elencoDeiBersagli(exclude)}` : '';
  if (oltreMain.length > 0) {
    const elenco = elencoDeiBersagli(oltreMain);
    const spunta = '«Do not require status checks on creation»';
    let cosa;
    if (oltreMain.includes('~ALL')) {
      // Con «All branches» quello che resta libero sono solo i rami esclusi
      // e, con la spunta, la creazione di rami nuovi: la frase dice quali.
      const tranne = exclude.length > 0 ? ` tranne quelli esclusi (${elencoDeiBersagli(exclude)})` : '';
      let effetto;
      if (exclude.length > 0 && creazioneLibera) {
        effetto = `Sui rami esclusi si spinge come prima, e con la spunta ${spunta} si possono ancora creare rami nuovi; su tutti gli altri rami che esistono gia' un commit nuovo entra solo se ha gia' passato la CI altrove`;
      } else if (exclude.length > 0) {
        effetto =
          'Sui rami esclusi si spinge come prima; su tutti gli altri un commit nuovo entra solo se ha gia\' passato la CI partendo da uno dei rami esclusi';
      } else if (creazioneLibera) {
        effetto = `Con la spunta ${spunta} si possono ancora creare rami nuovi; sui rami che esistono gia', invece, non si spinge piu' un commit che non abbia gia' passato la CI su un altro ramo`;
      } else {
        effetto =
          'Se la regola copre ogni ramo, quell\'altro ramo non c\'e\': nessuno puo\' piu\' spingere commit nuovi, su nessun ramo, e la CI non parte';
      }
      cosa =
        `guarda tutti i rami («All branches»)${tranne}, non solo main. Il controllo obbligatorio vale anche per le spinte: ` +
        `un commit nuovo entra in un ramo coperto solo se ha gia' passato la CI su un altro ramo. ${effetto}`;
    } else {
      cosa =
        `guarda anche rami che non sono main (${elenco}${esclusiDetti ? `, ${esclusiDetti}` : ''}). ` +
        (creazioneLibera
          ? `Il controllo obbligatorio vale anche per le spinte. Con la spunta ${spunta} quei rami si possono ancora creare, ma su quelli che esistono gia' un commit nuovo entra solo se ha gia' passato la CI su un altro ramo`
          : 'Il controllo obbligatorio vale anche per le spinte: su quei rami un commit nuovo entra solo se ha gia\' passato la CI su un altro ramo, e chi lavora li\' non riesce piu\' a spingere');
    }
    mancano.push({
      cosa,
      come: `Target branches → togli ${elenco} e lascia solo «Include default branch» (cioe' main).`,
      bloccaAltriRami: true,
    });
  }
  if (forseOltreMain.length > 0) {
    const elenco = elencoDeiBersagli(forseOltreMain);
    nonSoGiudicare.push({
      cosa: `non so dire se ${elenco} prende anche rami che non sono main${esclusiDetti ? `, ${esclusiDetti}` : ''}. Se li prende, su quei rami il controllo obbligatorio blocca le spinte`,
      come: `se vuoi solo main, togli ${elenco} e lascia solo «Include default branch»; altrimenti controlla a mano quali rami prende.`,
    });
  }

  // ③ Pretende il controllo «Main», pubblicato da GitHub Actions.
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

  return {
    letta: true,
    protegge: mancano.length === 0 && nonSoGiudicare.length === 0,
    ramoAggiornato,
    mancano,
    nonSoGiudicare,
    avvisi,
  };
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
  const dubbi = esito.nonSoGiudicare ?? [];
  const dubbioSuMain = dubbi.some((d) => d.suMain === true);
  // Se l'unico guaio e' che copre anche altri rami, le richieste rosse le
  // ferma: dirle «NON ferma» sarebbe falso. Il guaio e' che ferma troppo.
  // Ma se non so dire se guarda main, non lo dico nemmeno al contrario.
  const soloAltriRami = esito.mancano.length > 0 && esito.mancano.every((m) => m.bloccaAltriRami === true);
  let titolo;
  if (esito.protegge) {
    titolo = '✅ La regola «Main» ferma le richieste con la CI rossa: e\' accesa, guarda solo main e pretende il controllo «Main» verde.';
  } else if (esito.mancano.length === 0) {
    titolo =
      '⚪ Ho letto la regola «Main», ma non so giudicare se ferma le richieste con la CI rossa e guarda solo main. Controllala a mano:';
  } else if (soloAltriRami && !dubbioSuMain) {
    titolo = '❌ La regola «Main» ferma le richieste con la CI rossa, ma blocca anche le spinte sugli altri rami. Da sistemare:';
  } else if (soloAltriRami) {
    titolo = '❌ La regola «Main» blocca le spinte anche su rami che non sono main, e non so dire se ferma le richieste con la CI rossa. Da sistemare:';
  } else {
    const quante = esito.mancano.length === 1 ? 'Le manca una cosa' : `Le mancano ${esito.mancano.length} cose`;
    titolo = `❌ La regola «Main» NON ferma le richieste con la CI rossa. ${quante}:`;
  }
  const righe = [titolo];
  esito.mancano.forEach((m, i) => {
    righe.push(`   ${i + 1}. ${m.cosa}.`);
    righe.push(`      Dove si sistema: ${m.come}`);
  });
  for (const dubbio of dubbi) {
    righe.push(`   ⚪ Da controllare a mano: ${dubbio.cosa}.`);
    righe.push(`      Come uscirne: ${dubbio.come}`);
  }
  for (const avviso of esito.avvisi) righe.push(`   ⚠️  Da sapere: ${avviso}`);
  return righe;
}

/**
 * L'uscita del comando: 0 protegge; 1 di sicuro non protegge (o blocca altri
 * rami); 2 non ho letto la regola; 3 l'ho letta ma un modello dei rami non lo
 * so giudicare, e nient'altro e' sicuramente sbagliato.
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
  const vuoti = { letta: false, protegge: false, ramoAggiornato: null, mancano: [], nonSoGiudicare: [], avvisi: [] };
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
