import { readFileSync, mkdtempSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * 31/8/2026 (collaudo del rilascio, difetti ① ② ③) — ATTREZZI PER METTERE ALLA
 * PROVA IL LAVORO DI RILASCIO.
 *
 * Il difetto che ha reso necessario questo file: il ritorno indietro e la prova
 * di fumo non erano mai girati nemmeno una volta, quindi nessuno aveva mai visto
 * cosa facessero davvero. Leggere il file YAML e cercarci dentro una parola non
 * sarebbe bastato: una parola scritta nel posto giusto non dimostra che il
 * comando parta con gli argomenti giusti.
 *
 * Qui i passi del lavoro vengono ESEGUITI per davvero — la stessa shell, gli
 * stessi comandi — con `npx` e `curl` sostituiti da finti che registrano come
 * sono stati chiamati. Quello che non si puo' provare da qui e' il
 * comportamento della CLI vera di Vercel: quello resta un buco dichiarato.
 */

const RADICE = process.cwd();
const PERCORSO = join(RADICE, '.github/workflows/deploy-dopo-ci.yml');

export type Passo = {
  nome: string;
  id: string | null;
  se: string | null;
  run: string | null;
  /** `continue-on-error`: quando c'e', un passo fallito non ferma il lavoro. */
  continuaAncheSeFallisce: string | null;
  ambiente: Record<string, string>;
};

/**
 * Un lettore su misura per QUESTO file: i passi stanno a sei spazi, le loro
 * chiavi a otto, i blocchi di testo a dieci. Se il file cambia forma il lettore
 * non deve far finta di niente, quindi ogni passaggio che non torna alza
 * un'eccezione invece di restituire una lista vuota — una lista vuota renderebbe
 * verdi delle prove che non hanno guardato niente.
 */
export function passiDelLavoro(): Passo[] {
  const righe = readFileSync(PERCORSO, 'utf8').split('\n');
  const inizio = righe.findIndex((r) => r === '    steps:');
  if (inizio < 0) throw new Error('Non trovo la lista dei passi in .github/workflows/deploy-dopo-ci.yml');

  const passi: Passo[] = [];
  let corrente: string[] | null = null;
  for (let i = inizio + 1; i < righe.length; i++) {
    const riga = righe[i];
    if (riga.trim() === '') {
      if (corrente) corrente.push(riga);
      continue;
    }
    const rientro = riga.length - riga.trimStart().length;
    if (rientro < 6) break;
    if (riga.startsWith('      - ')) {
      if (corrente) passi.push(leggiPasso(corrente));
      corrente = [riga];
    } else if (corrente) {
      corrente.push(riga);
    }
  }
  if (corrente) passi.push(leggiPasso(corrente));

  if (passi.length < 6) {
    throw new Error(`Ho letto solo ${passi.length} passi: il lettore non sta capendo il file, non fidarti di queste prove`);
  }
  return passi;
}

function leggiPasso(righe: string[]): Passo {
  const testa = righe[0].replace(/^ {6}- /, '');
  const passo: Passo = { nome: '', id: null, se: null, run: null, continuaAncheSeFallisce: null, ambiente: {} };
  const corpo = [testa.length ? `        ${testa}` : '', ...righe.slice(1)];

  for (let i = 0; i < corpo.length; i++) {
    const riga = corpo[i];
    if (!riga.startsWith('        ') || riga.length - riga.trimStart().length !== 8) continue;
    const chiave = riga.trim();

    if (chiave.startsWith('name: ')) passo.nome = chiave.slice(6).trim();
    else if (chiave.startsWith('id: ')) passo.id = chiave.slice(4).trim();
    else if (chiave === 'run: |' || chiave === 'run: |-') passo.run = blocco(corpo, i);
    else if (chiave.startsWith('run: ')) passo.run = chiave.slice(5).trim();
    else if (chiave === 'if: >-' || chiave === 'if: >') passo.se = blocco(corpo, i).split('\n').join(' ').replace(/\s+/g, ' ').trim();
    else if (chiave.startsWith('if: ')) passo.se = chiave.slice(4).trim();
    else if (chiave === 'continue-on-error:' || chiave.startsWith('continue-on-error: ')) {
      passo.continuaAncheSeFallisce = chiave.slice('continue-on-error:'.length).trim();
    } else if (chiave === 'env:') {
      for (let j = i + 1; j < corpo.length; j++) {
        const r = corpo[j];
        if (r.trim() === '') continue;
        // 3/9/2026 — I COMMENTI NON SONO VARIABILI, E FERMAVANO LA LETTURA.
        //
        // Un commento senza due punti faceva uscire dal ciclo: tutte le
        // variabili scritte sotto quel commento sparivano dalla lista. Una
        // prova che chiede «in questo passo non ci sono manopole che
        // addomesticano la verifica» si sarebbe accontentata di una lista
        // troncata — cioe' bastava un commento per nascondere una manopola.
        if (r.trimStart().startsWith('#')) continue;
        if (r.length - r.trimStart().length !== 10) break;
        const sep = r.indexOf(':');
        if (sep < 0) break;
        passo.ambiente[r.slice(0, sep).trim()] = r.slice(sep + 1).trim();
      }
    }
  }
  if (!passo.nome) throw new Error(`Un passo senza nome: ${righe[0]}`);
  return passo;
}

function blocco(corpo: string[], da: number): string {
  const dentro: string[] = [];
  for (let j = da + 1; j < corpo.length; j++) {
    const r = corpo[j];
    if (r.trim() === '') {
      dentro.push('');
      continue;
    }
    if (r.length - r.trimStart().length < 10) break;
    dentro.push(r.slice(10));
  }
  return dentro.join('\n').replace(/\n+$/, '');
}

/** Il passo con questo nome, o un'eccezione che dice quali ci sono. */
export function passo(nome: string): Passo {
  const tutti = passiDelLavoro();
  const trovato = tutti.find((p) => p.nome === nome);
  if (!trovato) {
    throw new Error(`Nel lavoro di rilascio non c'e' nessun passo «${nome}». Ci sono: ${tutti.map((p) => p.nome).join(' | ')}`);
  }
  return trovato;
}

export type Esecuzione = {
  uscita: number;
  stdout: string;
  stderr: string;
  output: Record<string, string>;
  riepilogo: string;
  comandi: string[];
};

/**
 * Esegue davvero lo script di shell di un passo, con i comandi verso il mondo
 * esterno sostituiti da finti che si annotano come sono stati chiamati.
 */
export function esegui(p: Passo, opzioni: { env?: Record<string, string>; uscitaDeploy?: string; rispostaApi?: string; esitoRollback?: number; esitoDeploy?: number } = {}): Esecuzione {
  if (!p.run) throw new Error(`Il passo «${p.nome}» non ha uno script da eseguire`);

  const scena = mkdtempSync(join(tmpdir(), 'rilascio-'));
  const cestino = join(scena, 'bin');
  mkdirSync(cestino);
  const registro = join(scena, 'comandi.txt');
  const uscite = join(scena, 'output.txt');
  const riepilogo = join(scena, 'riepilogo.md');
  writeFileSync(registro, '');
  writeFileSync(uscite, '');
  writeFileSync(riepilogo, '');

  finto(cestino, 'npx', `
for a in "$@"; do
  case "$a" in
    deploy) printf '%s' "$FINTA_USCITA_DEPLOY"; exit "\${FINTO_ESITO_DEPLOY:-0}" ;;
    rollback) exit "\${FINTO_ESITO_ROLLBACK:-0}" ;;
  esac
done
exit 0
`);
  finto(cestino, 'curl', `
printf '%s' "$FINTA_RISPOSTA_API"
exit 0
`);

  const esito = spawnSync('bash', ['-c', p.run], {
    cwd: RADICE,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${cestino}:${process.env.PATH}`,
      REGISTRO: registro,
      GITHUB_OUTPUT: uscite,
      GITHUB_STEP_SUMMARY: riepilogo,
      FINTA_USCITA_DEPLOY: opzioni.uscitaDeploy ?? '',
      FINTA_RISPOSTA_API: opzioni.rispostaApi ?? '',
      FINTO_ESITO_ROLLBACK: String(opzioni.esitoRollback ?? 0),
      FINTO_ESITO_DEPLOY: String(opzioni.esitoDeploy ?? 0),
      ...(opzioni.env ?? {}),
    },
  });

  const righeUscita = readFileSync(uscite, 'utf8').split('\n').filter((r) => r.includes('='));
  const output: Record<string, string> = {};
  for (const r of righeUscita) output[r.slice(0, r.indexOf('='))] = r.slice(r.indexOf('=') + 1);

  return {
    uscita: esito.status ?? -1,
    stdout: esito.stdout ?? '',
    stderr: esito.stderr ?? '',
    output,
    riepilogo: readFileSync(riepilogo, 'utf8'),
    comandi: readFileSync(registro, 'utf8').split('\n').filter(Boolean),
  };
}

function finto(cestino: string, nome: string, corpo: string) {
  const percorso = join(cestino, nome);
  writeFileSync(percorso, `#!/usr/bin/env bash\nprintf '%s\\n' "${nome} $*" >> "$REGISTRO"\n${corpo}`);
  chmodSync(percorso, 0o755);
}

/**
 * Lo script vero, avviato come lo avvia il lavoro di rilascio: da riga di
 * comando. Cosi' si misura il numero d'uscita, che e' la cosa su cui il lavoro
 * decide se annullare un rilascio.
 */
export function cli(argomenti: string[], opzioni: { stdin?: string; env?: Record<string, string> } = {}) {
  const partito = Date.now();
  const esito = spawnSync('node', ['scripts/prova-di-fumo.mjs', ...argomenti], {
    cwd: RADICE,
    encoding: 'utf8',
    input: opzioni.stdin ?? '',
    env: { ...process.env, ...(opzioni.env ?? {}) },
    timeout: 60_000,
  });
  return {
    uscita: esito.status ?? -1,
    stdout: esito.stdout ?? '',
    stderr: esito.stderr ?? '',
    durataMs: Date.now() - partito,
  };
}

/**
 * L'uscita vera di `vercel deploy` con la CLI bloccata alla 59.10.0: l'avviso di
 * aggiornamento in coda NON e' l'eccezione, e' lo stato normale di ogni giorno
 * finche' la versione resta bloccata.
 */
export const USCITA_VERA_DEL_DEPLOY = [
  'Vercel CLI 59.10.0',
  'Retrieving project…',
  'Deploying NicolaeRotaru/mycity',
  'Inspect: https://vercel.com/nicolaerotaru/mycity/7Qd3kZq2 [1s]',
  'Production: https://mycity-abc123-nicolaerotaru.vercel.app [2s]',
  'https://mycity-abc123-nicolaerotaru.vercel.app',
  '> Update available 59.10.0 -> 62.0.1',
].join('\n');

export const INDIRIZZO_PUBBLICATO = 'https://mycity-abc123-nicolaerotaru.vercel.app';

/** Quello che risponde l'elenco dei rilasci di Vercel prima di pubblicare. */
export const RISPOSTA_DEI_RILASCI = JSON.stringify({
  deployments: [
    { uid: 'dpl_in_corso', url: 'mycity-in-corso.vercel.app', target: 'production', state: 'BUILDING' },
    { uid: 'dpl_anteprima', url: 'mycity-anteprima.vercel.app', target: 'preview', state: 'READY' },
    { uid: 'dpl_vivo', url: 'mycity-quello-di-prima.vercel.app', target: 'production', state: 'READY' },
  ],
});

export const INDIRIZZO_DI_PRIMA = 'https://mycity-quello-di-prima.vercel.app';

/** I segreti che il passo si aspetta di trovare gia' pronti. */
export const SEGRETI_FINTI = {
  TOKEN: 'finto-token',
  VERCEL_ORG_ID: 'finta-org',
  VERCEL_PROJECT_ID: 'finto-progetto',
};
