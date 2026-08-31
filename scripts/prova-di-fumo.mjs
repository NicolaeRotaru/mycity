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
 * @param {Array<{nome: string, ok: boolean, dettaglio: string}>} esiti
 */
export function esitoDellaProva(esiti) {
  const falliti = esiti.filter((e) => !e.ok);
  return {
    passata: falliti.length === 0,
    falliti,
    riassunto: falliti.length === 0
      ? `prova di fumo passata: ${esiti.length} controlli su ${esiti.length}`
      : `prova di fumo FALLITA su ${falliti.length} controlli su ${esiti.length}: ` +
        falliti.map((f) => `${f.nome} (${f.dettaglio})`).join('; '),
  };
}

/** Un solo controllo, con i suoi tentativi. */
export async function provaUnControllo(base, controllo, opzioni = {}) {
  const { tentativi = 5, attesaMs = 5000, timeoutMs = 10_000, fetchImpl = fetch, dormi } = opzioni;
  const aspetta = dormi ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  let dettaglio = 'mai provato';

  for (let n = 1; n <= tentativi; n++) {
    try {
      const ctrl = new AbortController();
      const scadenza = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetchImpl(`${base}${controllo.percorso}`, {
        signal: ctrl.signal,
        headers: { 'user-agent': 'mycity-prova-di-fumo' },
      });
      clearTimeout(scadenza);

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
  const esito = await provaDiFumo(base);
  console.log(esito.riassunto);
  process.exit(esito.passata ? USCITA.PASSATA : USCITA.SITO_ROTTO);
}
