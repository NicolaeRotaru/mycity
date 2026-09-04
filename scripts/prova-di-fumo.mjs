#!/usr/bin/env node
/**
 * SI PUBBLICAVA E NON GUARDAVA NESSUNO.
 *
 * Radiografia del 27/8/2026 (R178). Dopo `vercel deploy --prod` il lavoro di
 * rilascio finiva verde e basta. Se il sito rispondeva 500 a tutti, il verde
 * restava verde: nessuno controllava, e nessuno tornava indietro. Il primo a
 * saperlo era un cliente.
 *
 * Questo file e' la verifica minima che un rilascio ha senso: tre indirizzi,
 * qualche tentativo, e un esito che vale come sentenza.
 *
 *   · /api/health        — il processo e' vivo? (deve rispondere 2xx e NON
 *                          dichiararsi `unhealthy`)
 *   · /api/health/ready  — e' pronto a servire? (database raggiungibile)
 *   · /                  — la home si disegna davvero?
 *
 * PERCHE' I TENTATIVI. Subito dopo una pubblicazione la prima chiamata puo'
 * trovare la funzione ancora fredda. Un solo tentativo trasformerebbe una
 * partenza lenta in un finto guasto — e un finto guasto che fa tornare indietro
 * un rilascio buono e' peggio del difetto che si voleva prendere.
 *
 * PERCHE' UN MODULO E NON RIGHE DI SHELL. Cosi' e' provabile: la decisione sta
 * in `esitoDellaProva`, che non tocca la rete, e
 * tests/unit/la-prova-di-fumo-boccia-un-sito-rotto.test.ts la mette alle
 * strette sui casi che contano.
 *
 * 31/8/2026 (collaudo del rilascio, difetti ① ② ③) — QUI DENTRO SONO ARRIVATE
 * ALTRE TRE DECISIONI DEL RILASCIO, e non per comodita': erano righe di shell
 * dentro il file del lavoro,
 * cioe' codice che nessuno poteva mettere alla prova. Adesso stanno qui, con le
 * loro prove:
 *   · da quale riga dello stdout della CLI si prende l'indirizzo pubblicato
 *     (`estraiIndirizzo`) — prima era `tail -n 1`, e l'ultima riga della 59.10.0
 *     e' l'avviso di aggiornamento, non l'indirizzo;
 *   · a quale rilascio tornare indietro (`rilascioDaTornare`) — prima non lo si
 *     chiedeva a nessuno, e `vercel rollback` senza indirizzo non annulla niente;
 *   · che cosa ha verificato davvero questo lavoro (`verdettoDelLavoro`) — prima
 *     un lavoro che non aveva provato niente usciva verde come uno che aveva
 *     provato tutto.
 */

import { readFileSync } from 'node:fs';

/**
 * I numeri d'uscita. Non sono decorazione: il lavoro di rilascio decide se
 * ANNULLARE un rilascio guardando questo numero, e «il sito e' rotto» e «mi
 * avete dato una riga a caso al posto dell'indirizzo» hanno conseguenze
 * opposte. Prima erano tutti e due 1.
 */
export const USCITA = {
  PASSATA: 0,
  SITO_ROTTO: 1,
  USO_SBAGLIATO: 2,
  INDIRIZZO_NON_VALIDO: 3,
  // 3/9/2026 — «non ho potuto vedere il sito» e' un terzo esito, e non e' 1.
  // Vedi `muroDavantiAlSito` qui sotto: davanti alla produzione c'e' il login
  // di Vercel, e chi bussa senza chiave si prende un 401 che non dice NIENTE
  // sul sito. Rispondere «rotto» a quel 401 vorrebbe dire annullare un
  // rilascio sano a ogni pubblicazione.
  MURO_DAVANTI: 4,
};

/** Gli indirizzi da provare, con la regola che ognuno deve rispettare. */
export const CONTROLLI = [
  {
    percorso: '/api/health',
    nome: 'il processo e vivo',
    // `degraded` passa di proposito: vuol dire «in piedi ma con qualcosa da
    // guardare» — un database lento non e' un buon motivo per tornare indietro.
    accetta: (stato, corpo) => stato >= 200 && stato < 300 && corpo?.status !== 'unhealthy',
  },
  {
    percorso: '/api/health/ready',
    nome: 'e pronto a servire',
    accetta: (stato) => stato >= 200 && stato < 300,
  },
  {
    percorso: '/',
    nome: 'la home si disegna',
    accetta: (stato) => stato >= 200 && stato < 300,
  },
];

/**
 * 3/9/2026 — DAVANTI ALLA PRODUZIONE C'E' UN MURO, E LA PROVA DI FUMO CI
 * SBATTEVA CONTRO CHIAMANDOLO «SITO ROTTO».
 *
 * Stato verificato il 3/9/2026 con le chiavi vere: sul progetto Vercel `mycity`
 * la «Vercel Authentication» e' accesa su tutto tranne i domini personalizzati,
 * e di domini personalizzati non ce n'e' nessuno. Quindi ogni indirizzo
 * `*.vercel.app` — compreso quello che questo lavoro pubblica — risponde con la
 * schermata di accesso a chi non e' della squadra.
 *
 * Cosa sarebbe successo il giorno in cui si accendono i segreti: tre controlli
 * su tre respinti dal muro, uscita 1, e il passo dopo — che sull'1 sa fare una
 * cosa sola — avrebbe annullato un rilascio sanissimo. A ogni pubblicazione, e
 * tornando su un rilascio dietro lo stesso muro.
 *
 * PERCHE' BASTA IL CODICE DI RISPOSTA. Le tre porte che bussiamo non sanno
 * rispondere 401 ne' 403: `/api/health` e `/api/health/ready` rispondono 200 o
 * 503 e basta (il segreto serve solo a mostrare i dettagli, non a entrare), e
 * `/` e' pubblica — `middleware.ts` non nega niente, al massimo rimanda altrove.
 * Se arriva un 401 o un 403, a rispondere non e' stato il sito: e' qualcuno
 * davanti a lui. Gli indizi (il biscotto `_vercel_sso_nonce`, la pagina di
 * Vercel) servono solo a dire CHI, non SE.
 *
 * La chiave per passare esiste ed e' di Vercel: Settings → Deployment
 * Protection → Protection Bypass for Automation. Se il segreto c'e', si passa e
 * si guarda il sito davvero; se non c'e', si dice «non ho potuto vedere» — che
 * non e' un verde e non e' un motivo per buttare via un rilascio.
 *
 * @returns {string|null} chi sta davanti, oppure null se non c'e' nessun muro.
 */
export function muroDavantiAlSito(stato, indizi = {}) {
  if (stato !== 401 && stato !== 403) return null;
  const biscotto = String(indizi.biscotto ?? '');
  const corpo = String(indizi.corpo ?? '');
  if (/_vercel_sso_nonce/i.test(biscotto) || /sso-api|authentication required/i.test(corpo)) {
    return 'ha risposto il login di Vercel, non il sito';
  }
  return 'qualcuno davanti al sito ha rifiutato la chiamata prima che arrivasse';
}

/**
 * Gli indizi su CHI ha risposto, presi senza fidarsi: qui dentro puo' arrivare
 * una risposta vera di `fetch` o una finta di una prova, e un attrezzo che si
 * rompe leggendo un'intestazione trasformerebbe un muro in un guasto del sito.
 */
async function indiziDellaRisposta(risposta) {
  const indizi = { biscotto: '', corpo: '' };
  try {
    indizi.biscotto = risposta?.headers?.get?.('set-cookie') ?? '';
  } catch {
    // Una risposta senza intestazioni leggibili: resta un muro senza nome.
  }
  try {
    indizi.corpo = (await risposta.clone().text()).slice(0, 2000);
  } catch {
    // Idem: il nome e' un di piu', il muro l'ha gia' detto il codice.
  }
  return indizi;
}

/**
 * 31/8/2026 (collaudo del rilascio, difetto ②) — Un indirizzo e' un indirizzo
 * solo se lo e'. Il controllo serve prima di
 * toccare la rete: con «Updateavailable59.10.0->62.0.1» al posto dell'indirizzo
 * la prova di fumo ci metteva un minuto tondo per scoprire tre volte la stessa
 * cosa, e poi rispondeva «il sito e' rotto».
 */
export function eUnIndirizzo(testo) {
  if (typeof testo !== 'string') return false;
  const pulito = testo.trim();
  if (!pulito || /\s/.test(pulito)) return false;
  let indirizzo;
  try {
    indirizzo = new URL(pulito);
  } catch {
    return false;
  }
  if (indirizzo.protocol !== 'https:' && indirizzo.protocol !== 'http:') return false;
  return indirizzo.hostname.includes('.') && !indirizzo.hostname.endsWith('.');
}

// I codici colore del terminale: se la CLI li stampa, l'indirizzo arriva
// vestito e non somiglia piu al suo indirizzo.
const COLORI_DEL_TERMINALE = /\u001B\[[0-9;]*m/g;

/**
 * 31/8/2026 (collaudo del rilascio, difetto ②) — DOVE FINISCE IL SITO APPENA PUBBLICATO.
 *
 * Prima: `tail -n 1`. Con la CLI bloccata alla 59.10.0 l'ultima riga dello
 * stdout e' «> Update available 59.10.0 -> 62.0.1», che non e' l'eccezione ma
 * lo stato normale di ogni giorno finche' la versione resta bloccata.
 *
 * Non basta nemmeno «l'ultima cosa che sembra un indirizzo»: nelle stesse righe
 * ci sono il collegamento al pannello (`Inspect: https://vercel.com/…`) e
 * quello al changelog su GitHub. Il sito appena pubblicato e' l'unico che sta
 * su `*.vercel.app`, quindi si guarda quello e si butta via il resto. Se non ce
 * n'e' nessuno la risposta e' `null`: meglio fermare il rilascio che andare
 * avanti con una riga presa a caso.
 */
export function estraiIndirizzo(uscitaDellaCli) {
  if (typeof uscitaDellaCli !== 'string') return null;
  const trovati = [];
  for (const riga of uscitaDellaCli.replace(COLORI_DEL_TERMINALE, '').split(/\r?\n/)) {
    for (const pezzo of riga.split(/\s+/)) {
      const candidato = pezzo.replace(/[.,;:)\]]+$/, '');
      if (!/^https:\/\//i.test(candidato)) continue;
      let indirizzo;
      try {
        indirizzo = new URL(candidato);
      } catch {
        continue;
      }
      if (indirizzo.hostname.toLowerCase().endsWith('.vercel.app')) {
        trovati.push(`https://${indirizzo.hostname}`);
      }
    }
  }
  return trovati.length ? trovati[trovati.length - 1] : null;
}

/**
 * 31/8/2026 (collaudo del rilascio, difetto ①) — A QUALE RILASCIO TORNARE.
 *
 * `vercel rollback` senza indirizzo non torna indietro: nella 59.10.0 il primo
 * argomento posizionale, quando manca, vale «status», e il comando si limita a
 * dire che non c'e' nessun ritorno in corso — uscendo 0. Serve dirglielo, e
 * l'unico momento in cui si puo' sapere qual e' il rilascio a cui tornare e'
 * PRIMA di pubblicare quello nuovo.
 *
 * Qui arriva la risposta dell'elenco dei rilasci di Vercel. Si prende il primo
 * che sia davvero in produzione e davvero pronto: uno ancora in costruzione o
 * un'anteprima non sono posti dove tornare.
 */
export function rilascioDaTornare(rispostaDeiRilasci) {
  const elenco = Array.isArray(rispostaDeiRilasci?.deployments) ? rispostaDeiRilasci.deployments : [];
  for (const rilascio of elenco) {
    // L'elenco chiama lo stato ora `state` ora `readyState` a seconda della
    // versione dell'API: leggerne uno solo vorrebbe dire scartare tutto.
    const stato = String(rilascio?.readyState ?? rilascio?.state ?? '').toUpperCase();
    if (stato !== 'READY') continue;
    const bersaglio = String(rilascio?.target ?? '').toLowerCase();
    if (bersaglio !== 'production') continue;
    const grezzo = String(rilascio?.url ?? '').trim();
    if (!grezzo) continue;
    const completo = /^https?:\/\//i.test(grezzo) ? grezzo : `https://${grezzo}`;
    if (eUnIndirizzo(completo)) return completo;
  }
  return null;
}

/**
 * La sentenza, separata dalla rete perche' sia provabile.
 * @param {Array<{nome: string, ok: boolean, dettaglio: string, protetto?: boolean}>} esiti
 */
export function esitoDellaProva(esiti) {
  const falliti = esiti.filter((e) => !e.ok);
  // Se TUTTO quello che e' caduto e' caduto contro un muro, del sito non
  // sappiamo niente: non e' passata e non e' fallita, e' che non l'ho vista.
  // Se invece almeno un controllo e' caduto per conto suo — un 503, nessuna
  // risposta — allora il sito e' rotto davvero, e quello vale piu' del muro.
  const muri = falliti.filter((f) => f.protetto);
  const protetta = falliti.length > 0 && muri.length === falliti.length;
  let riassunto;
  if (falliti.length === 0) {
    riassunto = `prova di fumo passata: ${esiti.length} controlli su ${esiti.length}`;
  } else if (protetta) {
    riassunto =
      `non ho potuto vedere il sito: ${muri.length} controlli su ${esiti.length} si sono fermati davanti a un muro: ` +
      muri.map((f) => `${f.nome} (${f.dettaglio})`).join('; ');
  } else {
    riassunto =
      `prova di fumo FALLITA su ${falliti.length} controlli su ${esiti.length}: ` +
      falliti.map((f) => `${f.nome} (${f.dettaglio})`).join('; ');
  }
  return { passata: falliti.length === 0, protetta, falliti, riassunto };
}

/** Un solo controllo, con i suoi tentativi. */
export async function provaUnControllo(base, controllo, opzioni = {}) {
  const { tentativi = 5, attesaMs = 5000, timeoutMs = 10_000, fetchImpl = fetch, dormi, segretoDiPassaggio = '' } = opzioni;
  const aspetta = dormi ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  let dettaglio = 'mai provato';

  const intestazioni = { 'user-agent': 'mycity-prova-di-fumo' };
  if (segretoDiPassaggio) {
    // La chiave di servizio di Vercel per passare la schermata di accesso senza
    // essere una persona. Va nell'intestazione e non finisce mai in un `echo`:
    // e' un segreto, e i log del lavoro li legge chiunque abbia il repository.
    intestazioni['x-vercel-protection-bypass'] = segretoDiPassaggio;
    intestazioni['x-vercel-set-bypass-cookie'] = 'false';
  }

  for (let n = 1; n <= tentativi; n++) {
    try {
      const ctrl = new AbortController();
      const scadenza = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetchImpl(`${base}${controllo.percorso}`, {
        signal: ctrl.signal,
        headers: intestazioni,
      });
      clearTimeout(scadenza);

      // Un muro non e' un guasto: non si riprova cinque volte (la risposta
      // sarebbe la stessa) e non si dice «rotto», si dice «non ho visto».
      if (res.status === 401 || res.status === 403) {
        const muro = muroDavantiAlSito(res.status, await indiziDellaRisposta(res));
        if (muro) return { nome: controllo.nome, ok: false, protetto: true, dettaglio: `HTTP ${res.status}: ${muro}` };
      }

      let corpo = null;
      try {
        corpo = await res.clone().json();
      } catch {
        // La home non e' JSON: e' normale, conta solo il codice di risposta.
      }

      if (controllo.accetta(res.status, corpo)) {
        return { nome: controllo.nome, ok: true, dettaglio: `HTTP ${res.status} al tentativo ${n}` };
      }
      dettaglio = `HTTP ${res.status}${corpo?.status ? ` status=${corpo.status}` : ''}`;
    } catch (e) {
      dettaglio = e?.name === 'AbortError' ? `nessuna risposta entro ${timeoutMs} ms` : String(e?.message ?? e);
    }
    if (n < tentativi) await aspetta(attesaMs);
  }
  return { nome: controllo.nome, ok: false, dettaglio };
}

/** Tutti i controlli, in fila. */
export async function provaDiFumo(base, opzioni = {}) {
  const esiti = [];
  for (const c of CONTROLLI) esiti.push(await provaUnControllo(base, c, opzioni));
  return esitoDellaProva(esiti);
}

/**
 * 31/8/2026 (collaudo del rilascio, difetto ③) — CHE COSA HA VERIFICATO DAVVERO QUESTO LAVORO.
 *
 * Ventidue esecuzioni su ventidue verdi, e la prova di fumo non era mai girata
 * nemmeno una volta: senza le chiavi di Vercel il lavoro salta ogni passo e
 * finisce con la stessa spunta di un rilascio controllato. Zero controlli fatti
 * non e' un successo, e' un «non lo so» — e va detto, perche' e' su quella
 * spunta che si decide se fidarsi della produzione.
 */
export function verdettoDelLavoro(stato = {}) {
  const pronto = stato.pronto === true || String(stato.pronto ?? '').toLowerCase() === 'true';
  const indirizzo = String(stato.indirizzo ?? '').trim();
  const codice = String(stato.codiceFumo ?? '').trim();
  const tornato = String(stato.tornato ?? '').trim().toLowerCase() === 'si';
  const automatico = stato.rilascioAutomatico === true;

  let verdetto;
  if (!pronto) {
    verdetto = {
      verde: false,
      titolo: '## ⚪ Non ho provato niente',
      righe: [
        'Mancano le chiavi di Vercel, quindi da qui non e uscito nessun rilascio: niente pubblicazione, niente prova di fumo, niente ritorno indietro.',
        'Una spunta verde avrebbe voluto dire «il sito risponde». Io non lo so: e una cosa diversa, e chiamarla verde sarebbe una bugia.',
        'Si accende cosi: i tre segreti VERCEL_TOKEN, VERCEL_ORG_ID e VERCEL_PROJECT_ID in Settings → Secrets and variables → Actions.',
      ],
    };
  } else if (!indirizzo) {
    verdetto = {
      verde: false,
      titolo: '## ⚪ Non ho provato niente',
      righe: [
        'Non sono riuscita a sapere a quale indirizzo e finito il rilascio, quindi non sono andata a bussare da nessuna parte.',
        'Guarda il passo «Rilascia in produzione»: li si vede cosa ha stampato la CLI di Vercel.',
      ],
    };
  } else if (codice === '') {
    verdetto = {
      verde: false,
      titolo: '## ⚪ Non ho provato niente',
      righe: [
        `Il sito e stato pubblicato su ${indirizzo}, ma la prova di fumo non e girata: nessuno e andato a controllare se risponde.`,
      ],
    };
  } else if (codice === String(USCITA.PASSATA)) {
    verdetto = {
      verde: true,
      titolo: '## ✅ Il sito risponde',
      righe: [
        `Ho pubblicato su ${indirizzo} e sono andata a bussare a tre porte: il processo e vivo, e pronto a servire, la home si disegna.`,
      ],
    };
  } else if (codice === String(USCITA.SITO_ROTTO) && tornato) {
    verdetto = {
      verde: false,
      titolo: '## ⛔ Rilascio annullato',
      righe: [
        'Il sito appena pubblicato non ha superato la prova di fumo: sono tornata al rilascio di prima.',
        'Guarda il passo «Prova di fumo» qui sopra per sapere quale dei tre controlli e caduto.',
      ],
    };
  } else if (codice === String(USCITA.SITO_ROTTO)) {
    verdetto = {
      verde: false,
      titolo: '## ⛔ Il sito non risponde e in produzione c e ancora lui',
      righe: [
        `Il rilascio su ${indirizzo} non ha superato la prova di fumo e il ritorno indietro NON e riuscito.`,
        'Va fatto a mano su Vercel: apri il progetto, la scheda dei rilasci, e rimetti in produzione quello di prima.',
      ],
    };
  } else if (codice === String(USCITA.MURO_DAVANTI)) {
    verdetto = {
      verde: false,
      titolo: '## ⚪ Non ho potuto vedere il sito: davanti c e un muro',
      righe: [
        `Ho pubblicato su ${indirizzo}, ma alle tre porte ha risposto una schermata di accesso, non il sito: da qui non posso dire se funziona.`,
        'Non ho annullato niente, di proposito: un muro non dice che il rilascio e rotto, e buttarne via uno sano fa piu danno del difetto che volevo prendere.',
        'Si apre in due modi. Uno: su Vercel, il progetto → Settings → Deployment Protection → Protection Bypass for Automation, poi lo stesso valore fra i segreti del repository col nome VERCEL_AUTOMATION_BYPASS_SECRET. Due: un dominio pubblico tuo, che la protezione non copre.',
        'Finche resta cosi, dopo ogni rilascio il sito va aperto a mano per sapere se risponde.',
      ],
    };
  } else if (codice === String(USCITA.INDIRIZZO_NON_VALIDO)) {
    verdetto = {
      verde: false,
      titolo: '## ⚪ Non so in che stato sia la produzione',
      righe: [
        `Quello che mi e arrivato come indirizzo del rilascio — «${indirizzo}» — non e un indirizzo, quindi non ho potuto bussare da nessuna parte.`,
        'Non ho annullato niente di proposito: buttare via un rilascio senza sapere se e rotto fa piu danni del difetto che si voleva prendere.',
      ],
    };
  } else {
    verdetto = {
      verde: false,
      titolo: '## ⚪ Non so in che stato sia la produzione',
      righe: [`La prova di fumo e uscita col numero ${codice}, che non so leggere: guarda il passo qui sopra.`],
    };
  }

  if (automatico) {
    verdetto.righe.push(
      'Attenzione: in vercel.json il rilascio automatico su `main` e ancora acceso. Vercel pubblica in produzione **da solo** a ogni unione, e su quella strada non c e ne prova di fumo ne ritorno indietro: quello che leggi qui vale solo per il rilascio uscito da questo lavoro.',
    );
  }
  return verdetto;
}

/**
 * Le manopole della prova, lette dall'ambiente.
 *
 * PERCHE' ESISTONO. Con i valori di tutti i giorni una prova di fumo su un sito
 * che non risponde dura piu' di un minuto: nessuna prova automatica puo'
 * aspettare tanto, e senza una prova che la esegue davvero questa decisione
 * tornerebbe a essere codice che nessuno ha mai visto girare — che e' il
 * difetto da cui e' nato tutto questo file.
 *
 * PERCHE' NON SI POSSONO USARE PER SPEGNERLA. Sono limitate: almeno un
 * tentativo, almeno un secondo di attesa per la risposta. Non esiste un valore
 * che trasformi la prova in un saluto — e il lavoro di rilascio non le imposta,
 * cosa che una prova a parte tiene ferma.
 */
export function manopoleDaAmbiente(ambiente = {}) {
  const numero = (testo, predefinito, minimo, massimo) => {
    const n = Number.parseInt(String(testo ?? '').trim(), 10);
    if (!Number.isFinite(n)) return predefinito;
    return Math.min(Math.max(n, minimo), massimo);
  };
  return {
    tentativi: numero(ambiente.PROVA_TENTATIVI, 5, 1, 20),
    attesaMs: numero(ambiente.PROVA_ATTESA_MS, 5000, 0, 60_000),
    timeoutMs: numero(ambiente.PROVA_TIMEOUT_MS, 10_000, 1000, 60_000),
    segretoDiPassaggio: String(ambiente.VERCEL_AUTOMATION_BYPASS_SECRET ?? '').trim(),
  };
}

/** Legge da vercel.json se Vercel sta ancora pubblicando per conto suo. */
export function rilascioAutomaticoAcceso() {
  try {
    const configurazione = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
    return configurazione?.git?.deploymentEnabled?.main === true;
  } catch {
    return false;
  }
}

async function leggiTuttoDaStdin() {
  const pezzi = [];
  for await (const pezzo of process.stdin) pezzi.push(pezzo);
  return Buffer.concat(pezzi).toString('utf8');
}

// Avviato a mano dal lavoro di rilascio.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const comando = process.argv[2] ?? '';

  if (comando === '--indirizzo') {
    const trovato = estraiIndirizzo(await leggiTuttoDaStdin());
    if (!trovato) {
      console.error("Nell'uscita di `vercel deploy` non c'e' nessun indirizzo *.vercel.app: non so dove e' finito il rilascio.");
      process.exit(USCITA.INDIRIZZO_NON_VALIDO);
    }
    console.log(trovato);
    process.exit(USCITA.PASSATA);
  }

  if (comando === '--rilascio-di-adesso') {
    let risposta = null;
    try {
      risposta = JSON.parse(await leggiTuttoDaStdin());
    } catch {
      risposta = null;
    }
    const trovato = rilascioDaTornare(risposta);
    if (!trovato) {
      console.error("Nell'elenco dei rilasci non c'e' nessuna produzione pronta: non saprei a quale indirizzo tornare indietro.");
      process.exit(USCITA.INDIRIZZO_NON_VALIDO);
    }
    console.log(trovato);
    process.exit(USCITA.PASSATA);
  }

  if (comando === '--verdetto') {
    const verdetto = verdettoDelLavoro({
      pronto: process.env.PRONTO,
      indirizzo: process.env.INDIRIZZO,
      codiceFumo: process.env.CODICE_FUMO,
      tornato: process.env.TORNATO,
      rilascioAutomatico: rilascioAutomaticoAcceso(),
    });
    console.log([verdetto.titolo, '', ...verdetto.righe].join('\n'));
    process.exit(verdetto.verde ? 0 : 1);
  }

  const base = comando.replace(/\/+$/, '');
  if (!base) {
    console.error('Uso: node scripts/prova-di-fumo.mjs https://indirizzo-del-sito');
    process.exit(USCITA.USO_SBAGLIATO);
  }
  if (!eUnIndirizzo(base)) {
    // Uscire 1 qui vorrebbe dire «il sito e' rotto», e chi ci sta sopra
    // risponderebbe annullando il rilascio: un rilascio magari sanissimo,
    // buttato via perche' la riga che gli e' arrivata non era un indirizzo.
    console.error(`«${base}» non e un indirizzo: non c e niente a cui bussare, e da qui non si puo dire niente sul sito.`);
    process.exit(USCITA.INDIRIZZO_NON_VALIDO);
  }
  const esito = await provaDiFumo(base, manopoleDaAmbiente(process.env));
  console.log(esito.riassunto);
  if (esito.protetta) {
    // Non e' 1: sull'1 il lavoro annulla il rilascio, e annullare un rilascio
    // perche' non si e' potuto guardare vuol dire rompere la produzione per un
    // dubbio. Rosso si', ma un rosso che dice «non lo so».
    console.error('Nessuno dei tre controlli e arrivato al sito: da qui non posso dire se il rilascio e sano o rotto.');
    process.exit(USCITA.MURO_DAVANTI);
  }
  process.exit(esito.passata ? USCITA.PASSATA : USCITA.SITO_ROTTO);
}
