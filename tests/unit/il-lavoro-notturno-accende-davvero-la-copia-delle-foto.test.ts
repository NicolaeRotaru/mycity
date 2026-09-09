/**
 * 8/9/2026 — IL FILO CHE MANCAVA: LA COPIA DELLE FOTO NON SI SAREBBE ACCESA
 * NEMMENO COMPRANDO IL SECCHIO.
 *
 * Il pezzo che copia le immagini è scritto in fondo a `scripts/backup-db.sh`
 * dal 31 agosto, e il documento del ripristino promette che «si accende da solo
 * appena ci sono le variabili». Solo che il lavoro notturno le variabili non
 * gliele passava: gli dava l'indirizzo del database, la passphrase e la
 * cartella, e basta.
 *
 * Quindi il giorno in cui Nicola avesse comprato il secchio e messo le chiavi
 * nei segreti di GitHub, la copia delle foto NON sarebbe partita lo stesso — e
 * lui avrebbe visto una spunta verde e concluso che le foto erano al sicuro.
 * È il difetto peggiore dei tre: non «manca una copia» (lo sai), ma «credi di
 * averla» (non lo sai).
 *
 * Queste prove non cercano una parola nel file YAML. Prendono l'ambiente vero
 * che il lavoro costruisce per lo script, ci mettono dentro i valori che Nicola
 * scriverebbe in GitHub, e poi AVVIANO lo script vero per vedere se le foto si
 * copiano davvero. E fanno girare il pezzo di shell del guardiano con le
 * combinazioni di configurazione che una persona può sbagliare.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  readFileSync, mkdtempSync, mkdirSync, writeFileSync, chmodSync, existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FINTO_RCLONE, FINTO_PGDUMP } from './aiuti/finto-rclone';

const RADICE = process.cwd();
const PERCORSO = join(RADICE, '.github/workflows/backup-db.yml');

type Passo = { nome: string; run: string | null; ambiente: Record<string, string> };

/**
 * Un lettore su misura per QUESTO file: i lavori stanno a due spazi, i passi a
 * sei, le loro chiavi a otto, le variabili e i blocchi di testo a dieci. Ogni
 * passaggio che non torna alza un'eccezione invece di restituire una lista
 * vuota: una lista vuota renderebbe verdi delle prove che non hanno guardato
 * niente.
 */
function passiDelLavoro(lavoro: string): Passo[] {
  const righe = readFileSync(PERCORSO, 'utf8').split('\n');
  const iLavoro = righe.indexOf(`  ${lavoro}:`);
  if (iLavoro < 0) throw new Error(`Nel file non c'è nessun lavoro «${lavoro}»`);
  // Il lavoro finisce dove ne comincia un altro allo stesso rientro.
  let fineLavoro = righe.length;
  for (let i = iLavoro + 1; i < righe.length; i++) {
    if (/^ {2}[A-Za-z][\w-]*:\s*$/.test(righe[i])) { fineLavoro = i; break; }
  }
  const iSteps = righe.findIndex((r, i) => i > iLavoro && i < fineLavoro && r === '    steps:');
  if (iSteps < 0) throw new Error(`Il lavoro «${lavoro}» non ha una lista di passi`);

  const passi: Passo[] = [];
  let corrente: string[] | null = null;
  for (let i = iSteps + 1; i < fineLavoro; i++) {
    const riga = righe[i];
    if (riga.trim() === '') { if (corrente) corrente.push(riga); continue; }
    if (riga.length - riga.trimStart().length < 6) break;
    if (riga.startsWith('      - ')) {
      if (corrente) passi.push(leggiPasso(corrente));
      corrente = [riga];
    } else if (corrente) corrente.push(riga);
  }
  if (corrente) passi.push(leggiPasso(corrente));
  if (passi.length < 4) {
    throw new Error(`Ho letto solo ${passi.length} passi di «${lavoro}»: il lettore non sta capendo il file, non fidarti di queste prove`);
  }
  return passi;
}

function leggiPasso(righe: string[]): Passo {
  const testa = righe[0].replace(/^ {6}- /, '');
  const corpo = [`        ${testa}`, ...righe.slice(1)];
  const passo: Passo = { nome: '', run: null, ambiente: {} };

  for (let i = 0; i < corpo.length; i++) {
    const riga = corpo[i];
    if (!riga.startsWith('        ') || riga.length - riga.trimStart().length !== 8) continue;
    const chiave = riga.trim();
    if (chiave.startsWith('name: ')) passo.nome = chiave.slice(6).trim();
    else if (chiave === 'run: |' || chiave === 'run: |-') passo.run = blocco(corpo, i);
    else if (chiave.startsWith('run: ')) passo.run = chiave.slice(5).trim();
    else if (chiave === 'env:') {
      for (let j = i + 1; j < corpo.length; j++) {
        const r = corpo[j];
        if (r.trim() === '') continue;
        if (r.trimStart().startsWith('#')) continue; // un commento non è una variabile
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
    if (r.trim() === '') { dentro.push(''); continue; }
    if (r.length - r.trimStart().length < 10) break;
    dentro.push(r.slice(10));
  }
  return dentro.join('\n').replace(/\n+$/, '');
}

function passo(lavoro: string, nome: string): Passo {
  const tutti = passiDelLavoro(lavoro);
  const trovato = tutti.find((p) => p.nome === nome);
  if (!trovato) {
    throw new Error(`In «${lavoro}» non c'è nessun passo «${nome}». Ci sono: ${tutti.map((p) => p.nome).join(' | ')}`);
  }
  return trovato;
}

type Contesto = { vars?: Record<string, string>; secrets?: Record<string, string>; workspace?: string };

/** Fa quello che fa GitHub prima di avviare il passo: sostituisce le espressioni. */
function risolvi(ambiente: Record<string, string>, contesto: Contesto): Record<string, string> {
  const fuori: Record<string, string> = {};
  for (const [chiave, grezzo] of Object.entries(ambiente)) {
    fuori[chiave] = grezzo.replace(/\$\{\{\s*([a-z]+)\.([A-Za-z_][\w]*)\s*\}\}/g, (_i, dove, nome) => {
      if (dove === 'vars') return contesto.vars?.[nome] ?? '';
      if (dove === 'secrets') return contesto.secrets?.[nome] ?? '';
      if (dove === 'github' && nome === 'workspace') return contesto.workspace ?? '';
      return '';
    });
  }
  return fuori;
}

function percorsoDi(programma: string): string {
  const dove = ['/usr/bin', '/bin', '/usr/local/bin']
    .map((d) => join(d, programma))
    .find((p) => existsSync(p));
  if (!dove) throw new Error(`serve ${programma} per far girare la prova`);
  return dove;
}

/**
 * Una notte vera: si prende l'ambiente che il lavoro costruisce per lo script,
 * lo si risolve come farebbe GitHub, e si avvia `scripts/backup-db.sh`.
 */
function notteConLeVariabiliDiGitHub(nomePasso: string, lavoro: string, accesa: boolean) {
  const base = mkdtempSync(join(tmpdir(), 'filo-foto-'));
  const finti = join(base, 'finti');
  const fornitore = join(base, 'fornitore');
  const copia = join(base, 'copia');
  const spazio = join(base, 'spazio');
  for (const d of [finti, join(fornitore, 'products'), copia, join(spazio, 'backup')]) {
    mkdirSync(d, { recursive: true });
  }
  writeFileSync(join(fornitore, 'products', 'pane-del-giorno.jpg'), 'la foto del negoziante');
  writeFileSync(join(finti, 'pg_dump'), FINTO_PGDUMP);
  chmodSync(join(finti, 'pg_dump'), 0o755);
  writeFileSync(join(finti, 'rclone'), FINTO_RCLONE);
  chmodSync(join(finti, 'rclone'), 0o755);

  // Quello che Nicola scriverebbe in Settings → Secrets and variables.
  const variabiliDiGitHub: Record<string, string> = accesa
    ? {
        STORAGE_SYNC_SOURCE: `${fornitore}/`,
        STORAGE_SYNC_DEST: copia,
        STORAGE_SYNC_BUCKETS: 'products',
      }
    : {};

  const ambiente = risolvi(passo(lavoro, nomePasso).ambiente, {
    vars: variabiliDiGitHub,
    secrets: {
      SUPABASE_DB_URL: 'postgresql://finto:finto@localhost:5432/postgres',
      BACKUP_PASSPHRASE: '',
      RCLONE_CONFIG_BASE64: accesa ? 'ZmludGE=' : '',
    },
    workspace: spazio,
  });

  const e = spawnSync(percorsoDi('bash'), ['scripts/backup-db.sh'], {
    cwd: RADICE,
    encoding: 'utf8',
    timeout: 20_000,
    env: {
      NODE_ENV: process.env.NODE_ENV ?? 'test',
      PATH: `${finti}:${process.env.PATH ?? ''}`,
      HOME: process.env.HOME ?? '/root',
      ...ambiente,
    },
  });
  return { uscita: e.status, testo: `${e.stdout ?? ''}${e.stderr ?? ''}`, ambiente };
}

/** Fa girare il pezzo di shell di un passo, con le variabili che gli darebbe GitHub. */
function eseguiIlGuardiano(lavoro: string, nomePasso: string, contesto: Contesto) {
  const p = passo(lavoro, nomePasso);
  if (!p.run) throw new Error(`Il passo «${nomePasso}» non ha uno script da eseguire`);
  const base = mkdtempSync(join(tmpdir(), 'guardiano-foto-'));
  const uscite = join(base, 'output.txt');
  writeFileSync(uscite, '');
  const e = spawnSync(percorsoDi('bash'), ['-c', p.run], {
    cwd: RADICE,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_OUTPUT: uscite, ...risolvi(p.ambiente, contesto) },
  });
  return {
    uscita: e.status,
    testo: `${e.stdout ?? ''}${e.stderr ?? ''}`,
    output: readFileSync(uscite, 'utf8'),
  };
}

const SECCHIO_E_CHIAVI = {
  vars: { STORAGE_SYNC_SOURCE: 'supabase:', STORAGE_SYNC_DEST: 'b2:mycity-foto' },
  secrets: { RCLONE_CONFIG_BASE64: 'ZmludGE=' },
};

describe.each([
  ['backup', 'Esegui il backup', 'Le foto vanno in copia?'],
  ['prova-di-ripristino', 'Fai una copia fresca', 'Le foto vanno provate?'],
])('il lavoro «%s»', (lavoro, nomeCopia, nomeGuardiano) => {
  it('IL CASO CHE ROMPEVA — con il secchio configurato in GitHub, le foto si copiano davvero', () => {
    // Prima del 8/9/2026 questo passo non passava allo script nessuna delle
    // variabili delle foto: si potevano mettere tutte le chiavi del mondo nei
    // segreti e la copia restava spenta, con la spunta verde.
    const notte = notteConLeVariabiliDiGitHub(nomeCopia, lavoro, true);
    expect(
      notte.testo,
      `il lavoro non passa le variabili delle foto allo script. Gli passa solo: ${Object.keys(notte.ambiente).join(', ')}`,
    ).toContain('esito-foto: copiate e riaperte');
    expect(notte.testo).not.toContain('esito-foto: non-configurato');
    expect(notte.uscita, notte.testo).toBe(0);
  });

  it('finché il secchio non c è, il database si copia lo stesso e le foto lo dicono', () => {
    // Lo stato di oggi: nessuna variabile in GitHub. La copia del database non
    // deve rompersi per colpa delle foto.
    const notte = notteConLeVariabiliDiGitHub(nomeCopia, lavoro, false);
    expect(notte.testo).toContain('esito-foto: non-configurato');
    expect(notte.uscita, 'le foto spente facevano saltare anche la copia del database').toBe(0);
  });

  it('mezza configurazione diventa rossa, invece di sembrare accesa', () => {
    // La trappola: uno mette la variabile e si dimentica il segreto (o
    // viceversa). Senza guardiano il lavoro resta verde e non copia niente.
    const meta_da_provare: Contesto[] = [
      { vars: SECCHIO_E_CHIAVI.vars, secrets: {} },
      { vars: { STORAGE_SYNC_SOURCE: 'supabase:' }, secrets: SECCHIO_E_CHIAVI.secrets },
      { vars: { STORAGE_SYNC_DEST: 'b2:mycity-foto' }, secrets: {} },
    ];
    for (const meta of meta_da_provare) {
      const esito = eseguiIlGuardiano(lavoro, nomeGuardiano, meta);
      expect(esito.uscita, `mezza configurazione passava per buona: ${JSON.stringify(meta)}`).not.toBe(0);
      expect(esito.testo).toContain('configurata a meta');
      expect(esito.output, 'ha dichiarato la copia accesa con mezza configurazione').not.toContain('accesa=si');
    }
  });

  it('con tutte e tre le cose il guardiano dichiara la copia accesa', () => {
    const esito = eseguiIlGuardiano(lavoro, nomeGuardiano, SECCHIO_E_CHIAVI);
    expect(esito.uscita, esito.testo).toBe(0);
    expect(esito.output).toContain('accesa=si');
  });

  it('senza niente il guardiano lascia passare, ma lo scrive dove si vede', () => {
    const esito = eseguiIlGuardiano(lavoro, nomeGuardiano, { vars: {}, secrets: {} });
    expect(esito.uscita, esito.testo).toBe(0);
    expect(esito.output).toContain('accesa=no');
    // `::warning::` è l'annotazione che GitHub mostra in cima alla pagina del
    // lavoro: è lì che si guarda, non in fondo a un registro delle 02:17.
    expect(esito.testo).toContain('::warning::');
  });
});
