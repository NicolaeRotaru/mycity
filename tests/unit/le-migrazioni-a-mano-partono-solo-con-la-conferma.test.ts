/**
 * 19/10/2026 — IL PULSANTE CHE SCRIVE SUL DATABASE DI PRODUZIONE.
 *
 * `.github/workflows/migrazioni-a-mano.yml` applica al database vero le
 * migrazioni che mancano, in due lavori: uno conta senza scrivere, l'altro
 * scrive. Prima di scrivere deve fermarsi quando chi lo avvia non ha scritto
 * APPLICA, quando le migrazioni che mancano non sono quelle attese (quante e
 * quale e' l'ultima), quando la riga del database non e' quella del Session
 * pooler, quando sta girando la copia del database e quando su main i file
 * sono cambiati dopo l'avvio. Dopo, deve dire cosa e' entrato.
 *
 * Queste prove non cercano parole nel file: prendono il pezzo di shell vero
 * dal lavoro (o lo script che il lavoro chiama) e lo eseguono come lo esegue
 * GitHub (`bash -e`), con i valori che una persona puo' scrivere. Al posto
 * dello script delle migrazioni, di psql e di gh ci sono dei finti, che
 * rispondono come rispondono quelli veri; git e jq sono quelli veri. Una prova
 * lancia anche il conto vero sullo script vero, con un psql finto.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, mkdtempSync, existsSync, mkdirSync, writeFileSync, rmSync, readdirSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

// Lettore minimo del file, senza librerie. Toglie le righe di commento (un
// `if:` scritto in un commento non e' un `if:`), poi per ogni lavoro legge le
// sue chiavi e i suoi passi: il nome, le chiavi del passo, il blocco `run: |`
// riportato a filo e le righe `CHIAVE: valore` del suo `env:`.
type Passo = { name: string; run?: string; env: Record<string, string>; chiavi: Record<string, string> };
const testo = readFileSync(join(process.cwd(), '.github/workflows/migrazioni-a-mano.yml'), 'utf8')
  .split('\n')
  .filter((r) => !/^\s*#/.test(r))
  .join('\n');
const lavoro = (nome: 'conta' | 'applica') => {
  const inizio = testo.indexOf(`\n  ${nome}:\n`);
  expect(inizio, `nel file manca il lavoro «${nome}»`).toBeGreaterThan(-1);
  const dopo = testo.slice(inizio + 1).search(/\n {2}[a-z_]+:\n/);
  return dopo < 0 ? testo.slice(inizio) : testo.slice(inizio, inizio + 1 + dopo);
};
const chiaviDelLavoro = (nome: 'conta' | 'applica') => {
  const chiavi: Record<string, string> = {};
  for (const r of lavoro(nome).split('\n')) {
    const m = r.match(/^ {4}([a-z-]+):\s*(.*)$/);
    if (m) chiavi[m[1]] = m[2].trim();
  }
  return chiavi;
};
const rientro = (r: string) => r.length - r.trimStart().length;
const passiDi = (sezione: string): Passo[] => {
  const righe = sezione.split('\n');
  const passi: Passo[] = [];
  for (let i = 0; i < righe.length; i++) {
    const m = righe[i].match(/^(\s*)- name: (.+)$/);
    if (!m) continue;
    const base = m[1].length;
    const p: Passo = { name: m[2].trim(), env: {}, chiavi: {} };
    let j = i + 1;
    while (j < righe.length && (righe[j].trim() === '' || rientro(righe[j]) > base)) {
      const r = righe[j];
      const chiave = r.match(/^\s+([a-z-]+):\s*(.*)$/);
      if (chiave && rientro(r) === base + 2) p.chiavi[chiave[1]] = chiave[2].trim();
      if (/^\s*run: \|\s*$/.test(r)) {
        const dentro = rientro(r);
        const corpo: string[] = [];
        j++;
        while (j < righe.length && (righe[j].trim() === '' || rientro(righe[j]) > dentro)) {
          corpo.push(righe[j]);
          j++;
        }
        const filo = Math.min(...corpo.filter((x) => x.trim()).map(rientro));
        p.run = corpo.map((x) => x.slice(filo)).join('\n');
        continue;
      }
      const run1 = r.match(/^\s*run: (.+)$/);
      if (run1) p.run = run1[1];
      const env = r.match(/^\s+([A-Z_]+): (.+)$/);
      if (env) p.env[env[1]] = env[2].replace(/^"(.*)"$/, '$1');
      j++;
    }
    passi.push(p);
  }
  return passi;
};
const conta = passiDi(lavoro('conta'));
const applica = passiDi(lavoro('applica'));
const passo = (passi: Passo[], nome: string) => {
  const p = passi.find((x) => x.name === nome);
  expect(p, `nel lavoro manca il passo «${nome}»`).toBeDefined();
  return p as Passo;
};
const indice = (passi: Passo[], nome: string) => {
  const i = passi.findIndex((x) => x.name === nome);
  expect(i, `nel lavoro manca il passo «${nome}»`).toBeGreaterThan(-1);
  return i;
};
// Come GitHub esegue un `run:` senza `shell:` sui computer Linux: `bash -e`.
// GH_TOKEN e GITHUB_TOKEN vuoti: un passo li ha solo se li dichiara nel suo `env:`.
const esegui = (codice: string, env: Record<string, string>, cwd?: string) =>
  spawnSync('bash', ['-e', '-c', codice], {
    encoding: 'utf8', env: { ...process.env, GH_TOKEN: '', GITHUB_TOKEN: '', ...env }, cwd,
  });
// L'ambiente che GitHub darebbe al passo: le sue righe `env:`, con i segreti
// e il token sostituiti da valori finti.
const ambienteDel = (p: Passo, extra: Record<string, string> = {}) => {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(p.env)) {
    env[k] = v === '${{ github.token }}' ? 'token-finto'
      : v === '${{ secrets.SUPABASE_DB_URL }}' ? 'postgresql://finto@localhost/finto'
        : v;
  }
  return { GITHUB_REPOSITORY: 'NicolaeRotaru/mycity', ...env, ...extra };
};
const cartelleTemporanee: string[] = [];
afterAll(() => {
  for (const c of cartelleTemporanee) rmSync(c, { recursive: true, force: true });
});
const cartellaNuova = (nome: string) => {
  const c = mkdtempSync(join(tmpdir(), `${nome}-`));
  cartelleTemporanee.push(c);
  return c;
};

// Un `bash` finto al posto dello script delle migrazioni: stampa quello che
// stampa lo script vero ed esce col codice che gli diamo. Se gli si chiede un
// altro script, risponde come bash a un file che non c'e'.
const bashFinto = (uscita: number, mancano: string[], applicate: string[] = [], errore: string[] = []) => `bash() {
  [ "$1" = "scripts/applica-migrazioni-mancanti.sh" ] || { echo "bash: $1: No such file or directory" >&2; return 127; }
  ${applicate.map((f) => `echo "▶ applico ${f}"`).join('; ') || ':'}
  ${errore.map((e) => `echo '${e}' >&2`).join('; ') || ':'}
  ${mancano.length ? `echo "  Quelle che mancano:" >&2; ${mancano.map((f) => `echo "    - ${f}" >&2`).join('; ')}` : ':'}
  return ${uscita}
}
`;
const RIEPILOGO = { GITHUB_STEP_SUMMARY: '/dev/null' };
const nuovoRiepilogo = () => join(cartellaNuova('migrazioni-a-mano'), 'riepilogo.md');
// Lo script del conto lanciato come lo lancia il lavoro (`bash scripts/...`,
// un processo a parte): il `bash` finto gli arriva esportato.
const contaCon = (finto: string, env: Record<string, string>) =>
  esegui(`${finto}\nexport -f bash\ncommand bash scripts/conta-migrazioni-mancanti.sh`, { ...RIEPILOGO, ...env });

// Il solo passo che puo' avere un `if:`: gira dopo un guasto, non fa da freno.
const DOPO_IL_GUASTO = "Se si e' fermato, quello che manca ancora";

describe('chi puo\' avviarlo, e quando', () => {
  it('si avvia soltanto a mano, con tre caselle obbligatorie', () => {
    const on = testo.slice(testo.indexOf('\non:'), testo.indexOf('\npermissions:'));
    expect(on).toContain('workflow_dispatch:');
    expect(on).not.toMatch(/^\s+(push|pull_request|schedule|workflow_run):/m);
    for (const casella of ['conferma', 'quante', 'ultima']) {
      expect(on, `la casella «${casella}» non e' obbligatoria`).toMatch(new RegExp(`${casella}:[^]*?required: true`));
    }
  });

  it('chiede a GitHub solo di leggere: il codice, e le esecuzioni e gli ambienti', () => {
    const blocco = testo.slice(testo.indexOf('\npermissions:\n') + 1).split('\n').slice(1);
    const permessi: Record<string, string> = {};
    for (const r of blocco) {
      const m = r.match(/^ {2}([a-z-]+): (\S+)$/);
      if (!m) break;
      permessi[m[1]] = m[2];
    }
    expect(permessi).toEqual({ contents: 'read', actions: 'read' });
  });

  it('tutti e due i lavori girano solo da main, e nessun freno si puo\' saltare', () => {
    for (const nome of ['conta', 'applica'] as const) {
      const chiavi = chiaviDelLavoro(nome);
      expect(chiavi.if, `il lavoro «${nome}»`).toBe("github.ref == 'refs/heads/main'");
      expect(chiavi, `il lavoro «${nome}»`).not.toHaveProperty('continue-on-error');
      expect(chiavi['runs-on'], `il lavoro «${nome}»`).toBe('ubuntu-24.04');
    }
    // Un passo con `if:` o `continue-on-error:` e' un freno che puo' non
    // scattare; e un `shell:` diverso cambierebbe il modo in cui si ferma.
    for (const p of [...conta, ...applica]) {
      for (const vietata of ['continue-on-error', 'shell']) {
        expect(p.chiavi, `il passo «${p.name}» ha «${vietata}:»`).not.toHaveProperty(vietata);
      }
      if (p.name !== DOPO_IL_GUASTO) expect(p.chiavi, `il passo «${p.name}» ha «if:»`).not.toHaveProperty('if');
    }
  });

  it('il lavoro che scrive parte solo dopo quello che conta, ed e\' l\'unico nell\'ambiente da approvare', () => {
    expect(chiaviDelLavoro('applica').needs).toBe('conta');
    expect(chiaviDelLavoro('applica').environment).toBe('database-produzione');
    // Se l'ambiente stesse sul conto, Nicola approverebbe prima di vedere l'elenco.
    expect(chiaviDelLavoro('conta')).not.toHaveProperty('environment');
  });

  it('il lavoro che scrive ha il tempo per finire', () => {
    // Collaudo del 19/10: con 20 minuti poteva scadere a meta' delle 48.
    expect(Number(chiaviDelLavoro('applica')['timeout-minutes'])).toBeGreaterThanOrEqual(45);
  });

  it('il lavoro che scrive si mette in fila col rilascio automatico, e nessuno dei due annulla l\'altro', () => {
    // Collaudo del 19/10: con due gruppi diversi, un'unione su main durante il
    // lavoro faceva entrare due volte dieci migrazioni. Collaudo del 20/10: con
    // `cancel-in-progress: true` da una delle due parti, l'arrivo dell'altro
    // fermerebbe a meta' una scrittura.
    const proprio = lavoro('applica').match(/concurrency:\n\s+group: (\S+)\n\s+cancel-in-progress: false\n/)?.[1];
    const rilascio = readFileSync(join(process.cwd(), '.github/workflows/deploy-dopo-ci.yml'), 'utf8')
      .match(/^concurrency:\n\s+group: (\S+)\n\s+cancel-in-progress: false\n/m)?.[1];
    expect(rilascio).toBeDefined();
    expect(proprio).toBe(rilascio);
  });

  it('la conferma viene prima di qualunque altro passo, e senza APPLICA si ferma', () => {
    expect(conta[0].name).toBe('La conferma scritta');
    const codice = conta[0].run as string;
    for (const sbagliata of ['', 'applica', 'APP LICA', 'APPLICA!', 'si', 'vai']) {
      expect(esegui(codice, { CONFERMA: sbagliata }).status, `ha accettato «${sbagliata}»`).not.toBe(0);
    }
    // Lo spazio che la tastiera del telefono aggiunge non conta.
    for (const giusta of ['APPLICA', 'APPLICA ', ' APPLICA', 'APPLICA\t']) {
      expect(esegui(codice, { CONFERMA: giusta }).status, `ha rifiutato «${giusta}»`).toBe(0);
    }
  });

  it('quello che si scrive nelle caselle passa da variabili, non incollato nei comandi', () => {
    for (const p of [...conta, ...applica]) {
      if (p.run) expect(p.run, `il passo «${p.name}» incolla un valore nel comando`).not.toMatch(/\$\{\{\s*inputs\./);
    }
  });
});

describe('non mentre gira la copia del database', () => {
  const NOME = 'Non mentre gira la copia del database';
  // Un `gh` finto: risponde solo se gli si chiede l'elenco delle esecuzioni di
  // backup-db.yml del repository giusto, con un token; la risposta passa dal
  // filtro `--jq` vero del passo (con jq vero). Altrimenti un errore.
  const ghFinto = (esecuzioni: string, uscita = 0) => `gh() {
  local filtro="" tutto="$*"
  [ -n "$GH_TOKEN" ] || { echo "gh: set the GH_TOKEN environment variable" >&2; return 4; }
  [[ "$tutto" == *"run list"* && "$tutto" == *"--workflow backup-db.yml"* && "$tutto" == *"--repo NicolaeRotaru/mycity"* ]] || { echo "chiamata inattesa: $tutto" >&2; return 9; }
  while [ $# -gt 0 ]; do [ "$1" = "--jq" ] && filtro="$2"; shift; done
  [ ${uscita} = 0 ] || return ${uscita}
  echo '${esecuzioni}' | jq -r "$filtro"
}
`;

  it('nei due lavori, si ferma se una copia sta girando o e\' in coda, e se non riesce a vederlo', () => {
    // Fuori dal repository: nel lavoro che conta il passo gira prima del checkout.
    const fuori = cartellaNuova('senza-repo');
    for (const passi of [conta, applica]) {
      const p = passo(passi, NOME);
      const codice = p.run as string;
      for (const libero of ['[]', '[{"status":"completed"},{"status":"completed"}]']) {
        const r = esegui(ghFinto(libero) + codice, ambienteDel(p), fuori);
        expect(r.status, `con ${libero}: ${r.stdout}${r.stderr}`).toBe(0);
      }
      for (const stato of ['queued', 'in_progress', 'waiting', 'requested', 'pending']) {
        const r = esegui(ghFinto(`[{"status":"completed"},{"status":"${stato}"}]`) + codice, ambienteDel(p), fuori);
        expect(r.status, `con una copia «${stato}»`).not.toBe(0);
      }
      expect(esegui(ghFinto('[]', 1) + codice, ambienteDel(p), fuori).status, 'gh non risponde').not.toBe(0);
    }
  });

  it('nel lavoro che conta viene prima del conto; in quello che scrive, subito prima di scrivere', () => {
    expect(indice(conta, NOME)).toBeLessThan(indice(conta, 'Conta quelle che mancano'));
    // Nel lavoro che scrive l'«Approve» puo' arrivare ore dopo: il controllo
    // sta attaccato alla scrittura.
    expect(indice(applica, NOME) + 1).toBe(indice(applica, 'Applica le migrazioni che mancano'));
  });
});

describe('i file sono ancora quelli di main', () => {
  const NOME = 'Migrazioni e script sono ancora quelli di main';
  const GIT_ENV = {
    GIT_AUTHOR_NAME: 'prova', GIT_AUTHOR_EMAIL: 'prova@example.com',
    GIT_COMMITTER_NAME: 'prova', GIT_COMMITTER_EMAIL: 'prova@example.com',
  };
  const git = (cwd: string, ...argomenti: string[]) => {
    const r = spawnSync('git', argomenti, { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } });
    expect(r.status, `git ${argomenti.join(' ')}: ${r.stderr}`).toBe(0);
  };
  // I file che, se cambiano su main dopo l'avvio, devono fermare il lavoro.
  const CONTANO = [
    'migrations/164_prova.sql',
    'scripts/applica-migrazioni-mancanti.sh',
    'scripts/conta-migrazioni-mancanti.sh',
    'scripts/check-migration-drift.mjs',
    '.github/workflows/migrazioni-a-mano.yml',
  ];
  // Un main con un commit, e una copia fatta come la fa actions/checkout: un
  // commit solo, preso con un fetch, che lascia FETCH_HEAD sul commit di
  // partenza. Poi su main succede `dopo`, e nella copia gira il passo.
  const scenario = (codice: string, dopo: (main: string) => void) => {
    const base = cartellaNuova('ancora-main');
    const main = join(base, 'main');
    for (const f of [...CONTANO, 'README.md']) {
      mkdirSync(dirname(join(main, f)), { recursive: true });
      writeFileSync(join(main, f), 'uno\n');
    }
    git(main, 'init', '-q', '-b', 'main');
    git(main, 'add', '-A');
    git(main, 'commit', '-qm', 'avvio');
    const copia = join(base, 'copia');
    git(base, 'clone', '-q', '--depth=1', `file://${main}`, 'copia');
    git(copia, 'fetch', '-q', '--depth=1', 'origin', 'main');
    dopo(main);
    return esegui(codice, GIT_ENV, copia);
  };
  const committa = (main: string) => { git(main, 'add', '-A'); git(main, 'commit', '-qm', 'dopo'); };
  // Ogni scenario crea due repository git: sotto il carico dell'intera suite i
  // cinque secondi di default non bastano (collaudo del 20/10: 5,4 secondi).
  const LENTA = { timeout: 60_000 };

  it('nei due lavori, va avanti se su main non e\' cambiato niente che conti', LENTA, () => {
    for (const passi of [conta, applica]) {
      const codice = passo(passi, NOME).run as string;
      const fermo = scenario(codice, () => {});
      expect(fermo.status, fermo.stdout + fermo.stderr).toBe(0);
      const altro = scenario(codice, (m) => { writeFileSync(join(m, 'README.md'), 'due\n'); committa(m); });
      expect(altro.status, altro.stdout + altro.stderr).toBe(0);
    }
  });

  it('nei due lavori, si ferma se su main e\' cambiato uno dei file che contano, o se main non si legge', LENTA, () => {
    for (const passi of [conta, applica]) {
      const codice = passo(passi, NOME).run as string;
      const casi: Record<string, (m: string) => void> = {
        'migrazione tolta': (m) => { rmSync(join(m, CONTANO[0])); committa(m); },
        'migrazione aggiunta': (m) => { writeFileSync(join(m, 'migrations', '165_nuova.sql'), 'tre\n'); committa(m); },
        'main sparito': (m) => { rmSync(m, { recursive: true, force: true }); },
      };
      for (const f of CONTANO) casi[`cambiato ${f}`] = (m) => { writeFileSync(join(m, f), 'due\n'); committa(m); };
      for (const [caso, dopo] of Object.entries(casi)) {
        expect(scenario(codice, dopo).status, caso).not.toBe(0);
      }
    }
  });

  it('viene dopo il checkout; nel lavoro che scrive, subito prima della scrittura', () => {
    for (const passi of [conta, applica]) {
      expect(indice(passi, 'Checkout')).toBeLessThan(indice(passi, NOME));
    }
    expect(indice(conta, NOME)).toBeLessThan(indice(conta, 'Conta quelle che mancano'));
    expect(indice(applica, 'Riconta subito prima di scrivere')).toBeLessThan(indice(applica, NOME));
    expect(indice(applica, NOME) + 1).toBe(indice(applica, 'Non mentre gira la copia del database'));
  });
});

describe('la riga del database deve essere quella del Session pooler', () => {
  const codice = () => passo(conta, 'La riga del database').run as string;

  it('lascia passare la riga del Session pooler', () => {
    const r = esegui(codice(), {
      SUPABASE_DB_URL: 'postgresql://postgres.abcdefgh:segreta@aws-0-eu-west-3.pooler.supabase.com:5432/postgres',
    });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });

  it('ferma la connessione diretta e il Transaction pooler', () => {
    for (const riga of [
      'postgresql://postgres:segreta@db.abcdefgh.supabase.co:5432/postgres',
      'postgresql://postgres.abcdefgh:segreta@aws-0-eu-west-3.pooler.supabase.com:6543/postgres',
    ]) {
      const r = esegui(codice(), { SUPABASE_DB_URL: riga });
      expect(r.status, `ha accettato ${riga.replace(/:[^:@]+@/, ':***@')}`).not.toBe(0);
      expect(r.stdout + r.stderr).toContain('Session pooler');
    }
  });

  it('ferma una riga vuota o incollata male, senza mai stamparla', () => {
    for (const brutta of ['', 'psql "postgresql://x"', ' postgresql://x', 'https://abcdefgh.supabase.co']) {
      expect(esegui(codice(), { SUPABASE_DB_URL: brutta }).status, `ha accettato «${brutta}»`).not.toBe(0);
    }
    const r = esegui(codice(), { SUPABASE_DB_URL: 'valore-segretissimo-da-non-stampare' });
    expect(r.stdout + r.stderr).not.toContain('valore-segretissimo-da-non-stampare');
  });
});

describe('l\'avviso sull\'«Approve», prima dell\'elenco', () => {
  const NOME = 'Il secondo lavoro aspetta il tuo «Approve»?';
  // Un `gh api` finto: la risposta dell'ambiente passa dal filtro vero del passo.
  const ghFinto = (ambiente: string, uscita = 0, errore = '') => `gh() {
  local filtro="" tutto="$*"
  [ -n "$GH_TOKEN" ] || { echo "gh: set the GH_TOKEN environment variable" >&2; return 4; }
  [[ "$tutto" == *"api repos/NicolaeRotaru/mycity/environments/database-produzione"* ]] || { echo "chiamata inattesa: $tutto" >&2; return 9; }
  while [ $# -gt 0 ]; do [ "$1" = "--jq" ] && filtro="$2"; shift; done
  [ ${uscita} = 0 ] || { echo '${errore}' >&2; return ${uscita}; }
  echo '${ambiente}' | jq -r "$filtro"
}
`;

  it('dice se il secondo lavoro aspetta, e non ferma mai il conto', () => {
    const p = passo(conta, NOME);
    const codice = p.run as string;
    const casi: Array<[string, number, string, string]> = [
      ['{"protection_rules":[{"type":"wait_timer"},{"type":"required_reviewers"}]}', 0, '', 'aspetta il tuo'],
      ['{"protection_rules":[]}', 0, '', 'non chiede'],
      ['{"name":"database-produzione"}', 0, '', 'non chiede'],
      ['{"protection_rules":[{"type":"branch_policy"}]}', 0, '', 'non chiede'],
      // Al primo avvio l'ambiente non c'e': GitHub lo crea senza regole.
      ['', 1, 'gh: Not Found (HTTP 404)', 'non esiste ancora'],
      ['', 1, 'gh: Resource not accessible by integration (HTTP 403)', 'Non sono riuscito'],
    ];
    for (const [ambiente, uscita, errore, frase] of casi) {
      const riepilogo = nuovoRiepilogo();
      const r = esegui(ghFinto(ambiente, uscita, errore) + codice, ambienteDel(p, { GITHUB_STEP_SUMMARY: riepilogo }));
      expect(r.status, `${ambiente}${errore}: ${r.stderr}`).toBe(0);
      expect(readFileSync(riepilogo, 'utf8'), `${ambiente}${errore}`).toContain(frase);
    }
    expect(indice(conta, NOME)).toBeLessThan(indice(conta, 'Conta quelle che mancano'));
  });
});

describe('il conto, prima di scrivere e di nuovo subito prima', () => {
  const elenco = ['092_a.sql', '093_b.sql', '161_c.sql', '163_d.sql'];

  it('tutti e due i lavori contano con lo stesso script, prima di scrivere', () => {
    expect(passo(conta, 'Conta quelle che mancano').run).toBe('bash scripts/conta-migrazioni-mancanti.sh');
    expect(passo(applica, 'Riconta subito prima di scrivere').run).toBe('bash scripts/conta-migrazioni-mancanti.sh');
    expect(indice(applica, 'Riconta subito prima di scrivere')).toBeLessThan(indice(applica, 'Applica le migrazioni che mancano'));
    for (const p of [passo(conta, 'Conta quelle che mancano'), passo(applica, 'Riconta subito prima di scrivere')]) {
      expect(p.env.QUANTE).toBe('${{ inputs.quante }}');
      expect(p.env.ULTIMA).toBe('${{ inputs.ultima }}');
    }
  });

  it('chiede allo script delle migrazioni di fermarsi prima di scrivere (tetto 0, non il numero atteso)', () => {
    const segno = join(cartellaNuova('tetto'), 'tetto');
    // Il `bash` finto annota il tetto con cui e' stato chiamato, e risponde
    // come lo script vero quando ne mancano quattro.
    const finto = bashFinto(4, elenco).replace('bash() {', `bash() {\n  echo "\${MASSIMO_MIGRAZIONI-nessuno}" > "${segno}"`);
    const r = contaCon(finto, { QUANTE: '4', ULTIMA: '163' });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(readFileSync(segno, 'utf8').trim()).toBe('0');
  });

  it('va avanti solo se ne mancano quante ne aspetti, e l\'ultima e\' quella attesa', () => {
    const riepilogo = nuovoRiepilogo();
    const giusto = contaCon(bashFinto(4, elenco), { QUANTE: '4', ULTIMA: '163', GITHUB_STEP_SUMMARY: riepilogo });
    expect(giusto.status, giusto.stdout + giusto.stderr).toBe(0);
    // Chi approva deve vedere l'elenco, non solo i numeri.
    for (const f of elenco) expect(readFileSync(riepilogo, 'utf8')).toContain(`- ${f}`);
    for (const quante of ['3', '5', '48', '04', '']) {
      expect(contaCon(bashFinto(4, elenco), { QUANTE: quante, ULTIMA: '163' }).status, `quante «${quante}»`).not.toBe(0);
    }
    // Il numero torna, ma l'ultima no: 47 attese piu' una sconosciuta fanno 48 lo stesso.
    for (const ultima of ['161', '164', '16', 'tutte', '']) {
      expect(contaCon(bashFinto(4, elenco), { QUANTE: '4', ULTIMA: ultima }).status, `ultima «${ultima}»`).not.toBe(0);
    }
    // Lo spazio che la tastiera del telefono aggiunge non conta.
    expect(contaCon(bashFinto(4, elenco), { QUANTE: '4 ', ULTIMA: ' 163 ' }).status).toBe(0);
  });

  it('una casella scritta male ferma il conto prima ancora di chiedere al database', () => {
    const segno = join(cartellaNuova('conto'), 'chiamato');
    // Il `bash` finto lascia un segno se viene chiamato: qui non deve esserlo mai.
    const finto = `bash() { touch "${segno}"; return 0; }\n`;
    const casi: Array<[string, string]> = [
      ['', '163'], ['4x', '163'], ['4 4', '163'], ['-1', '163'],
      ['0', ''], ['0', '16'], ['0', '1634'], ['0', 'tutte'], ['0', '163_'], ['0', '16 3'],
    ];
    for (const [quante, ultima] of casi) {
      const r = contaCon(finto, { QUANTE: quante, ULTIMA: ultima });
      expect(r.status, `quante «${quante}», ultima «${ultima}»`).not.toBe(0);
      expect(existsSync(segno), `con quante «${quante}» e ultima «${ultima}» ha interrogato il database`).toBe(false);
    }
  });

  it('se non manca niente e ne aspettavi zero, va avanti', () => {
    expect(contaCon(bashFinto(0, []), { QUANTE: '0', ULTIMA: '163' }).status).toBe(0);
    expect(contaCon(bashFinto(0, []), { QUANTE: '48', ULTIMA: '163' }).status).not.toBe(0);
  });

  it('se lo script dice che manca qualcosa ma l\'elenco non si legge, non va avanti', () => {
    // Collaudo del 19/10: con l'elenco scritto in un altro modo, il conto
    // diceva «ne mancano 0» su un database a cui ne mancavano 48.
    const r = contaCon(bashFinto(4, [], [], ['  · 092_a.sql']), { QUANTE: '0', ULTIMA: '163' });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toContain("non sono riuscito a leggere l'elenco");
  });

  it('se lo script delle migrazioni si ferma per un altro motivo, non va avanti e il motivo finisce nel riepilogo', () => {
    for (const uscita of [1, 2, 3]) {
      expect(contaCon(bashFinto(uscita, elenco), { QUANTE: '4', ULTIMA: '163' }).status, `uscita ${uscita}`).not.toBe(0);
    }
    const riepilogo = nuovoRiepilogo();
    const errore = [
      'psql: error: connection to server failed: postgresql://postgres.abc:pezzo-di-password@aws-0.pooler.supabase.com',
      'psql: error: could not translate host name "Segreto9@127.0.0.1" to address',
      '✗ non riesco a collegarmi al database: nessuna migrazione applicata.',
      '  Il database risponde, ma rifiuta utente o password.',
    ];
    const r = contaCon(bashFinto(1, [], [], errore), { QUANTE: '48', ULTIMA: '163', GITHUB_STEP_SUMMARY: riepilogo });
    expect(r.status).not.toBe(0);
    const scritto = readFileSync(riepilogo, 'utf8');
    expect(scritto).toContain('non riesco a collegarmi al database');
    expect(scritto).toContain('rifiuta utente o password');
    // Una riga con un indirizzo, o con una «@», non passa mai nel riepilogo.
    expect(scritto).not.toContain('pezzo-di-password');
    expect(scritto).not.toContain('Segreto9');
    expect(scritto).not.toContain('://');
  });
});

describe('il conto vero sullo script vero', () => {
  // Il conto dipende da come lo script ufficiale scrive l'elenco (`    - file`)
  // e da come rispetta il tetto. Qui girano tutti e due veri, con un `psql`
  // finto che fa la parte del registro: conosce tutte le versioni tranne quelle
  // in FINTE_MANCANTI, e annota ogni file che gli si chiede di applicare.
  const migrazioni = () => spawnSync('sort', ['-V'], {
    input: readdirSync(join(process.cwd(), 'migrations')).filter((f) => /^\d{3}[a-z]?_.+\.sql$/.test(f)).join('\n'),
    encoding: 'utf8',
  }).stdout.trim().split('\n');
  const psqlFinto = () => {
    const cartella = cartellaNuova('psql-finto');
    writeFileSync(join(cartella, 'registro.txt'), '');
    writeFileSync(join(cartella, 'psql'), `#!/usr/bin/env bash
query=""; file=""
while [ $# -gt 0 ]; do
  case "$1" in
    -c) query="$2"; shift 2 ;;
    -f) file="$2"; shift 2 ;;
    *) shift ;;
  esac
done
if [ -n "$file" ]; then echo "APPLICATO $(basename "$file")" >> "$REGISTRO_PSQL"; exit 0; fi
if [ -z "$query" ]; then cat > /dev/null; exit 0; fi
case "$query" in
  *"count(*)"*) echo 156 ;;
  *INSERT*) echo "REGISTRATO" >> "$REGISTRO_PSQL" ;;
  *"SELECT 1 FROM supabase_migrations.schema_migrations"*)
    v="$(printf '%s' "$query" | sed -nE "s/.*version = '([^']+)'.*/\\1/p" | head -1)"
    case " \${FINTE_MANCANTI:-} " in *" $v "*) ;; *) echo 1 ;; esac
    ;;
esac
exit 0
`);
    chmodSync(join(cartella, 'psql'), 0o755);
    return cartella;
  };
  const lancia = (quante: string, ultima: string, mancanti: string[]) => {
    const cartella = psqlFinto();
    const r = spawnSync('bash', ['scripts/conta-migrazioni-mancanti.sh'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${cartella}:${process.env.PATH}`,
        SUPABASE_DB_URL: 'postgresql://finto@localhost/finto',
        REGISTRO_PSQL: join(cartella, 'registro.txt'),
        FINTE_MANCANTI: mancanti.map((f) => f.slice(0, f.indexOf('_'))).join(' '),
        QUANTE: quante, ULTIMA: ultima, GITHUB_STEP_SUMMARY: '/dev/null',
      },
    });
    return { ...r, scritto: readFileSync(join(cartella, 'registro.txt'), 'utf8') };
  };
  // Lo script vero chiama `psql` un paio di centinaia di volte.
  const LENTA = { timeout: 60_000 };

  it('conta senza applicare niente, e riconosce l\'elenco dello script vero', LENTA, () => {
    const ultime = migrazioni().slice(-4);
    const ultima = ultime[3].slice(0, ultime[3].indexOf('_'));
    const giusto = lancia('4', ultima, ultime);
    expect(giusto.status, giusto.stdout + giusto.stderr).toBe(0);
    expect(giusto.stdout).toContain(`ne mancano 4, l'ultima e' la ${ultima}`);
    expect(giusto.scritto, 'il conto ha applicato o registrato qualcosa').toBe('');
    const sbagliato = lancia('3', ultima, ultime);
    expect(sbagliato.status).not.toBe(0);
    expect(sbagliato.scritto, 'il conto ha applicato o registrato qualcosa').toBe('');
  });
});

describe('quello che fa il lavoro che scrive', () => {
  const NOME = 'Applica le migrazioni che mancano';
  const TETTO = { MASSIMO_MIGRAZIONI: '48' };
  // Un psql finto che risponde solo alle chiamate fatte come quelle vere
  // (-X -A -t: senza, psql stamperebbe anche l'intestazione). «registrata» e'
  // la versione che il registro conosce; con «rotto», non risponde affatto.
  const psqlFinto = (registrata: string) => registrata === 'rotto'
    ? 'psql() { return 2; }\n'
    : `psql() {
  [[ " $* " == *" -X "* && " $* " == *" -A "* && " $* " == *" -t "* ]] || { echo "psql: opzioni inattese: $*" >&2; return 3; }
  [[ "$*" == *"version = '${registrata}'"* ]] && echo 1
  return 0
}
`;

  it('applica con lo script del rilascio, e il tetto e\' il numero contato, senza spazi', () => {
    const p = passo(applica, NOME);
    expect(p.run).toContain('bash scripts/applica-migrazioni-mancanti.sh');
    expect(p.env.MASSIMO_MIGRAZIONI).toBe('${{ inputs.quante }}');
    expect(p.chiavi.id).toBe('scrivi');
    const segno = join(cartellaNuova('tetto-scrive'), 'tetto');
    const finto = bashFinto(0, []).replace('bash() {', `bash() {\n  echo "\${MASSIMO_MIGRAZIONI-nessuno}" > "${segno}"`);
    const r = esegui(finto + (p.run as string), { ...RIEPILOGO, MASSIMO_MIGRAZIONI: ' 48 ' });
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(segno, 'utf8').trim()).toBe('48');
    // Un tetto vuoto, per lo script, vorrebbe dire «nessun tetto»: non si scrive.
    for (const brutto of ['', ' ', '4x']) {
      rmSync(segno, { force: true });
      const male = esegui(finto + (p.run as string), { ...RIEPILOGO, MASSIMO_MIGRAZIONI: brutto });
      expect(male.status, `tetto «${brutto}»`).not.toBe(0);
      expect(existsSync(segno), `con il tetto «${brutto}» ha lanciato lo script`).toBe(false);
    }
  });

  it('se lo script si ferma a meta\', il passo fallisce e il riepilogo dice cosa e\' entrato, dove e perche\'', () => {
    const codice = passo(applica, NOME).run as string;
    // 113 gira in una transazione sola; 153 ha un COMMIT suo.
    const casi: Array<[string, string, string]> = [
      ['113_revoke_public_writes_on_views.sql', 'nessuna', 'gira in una transazione sola'],
      ['153_il_reso_lo_apre_il_server_non_il_cliente.sql', 'nessuna', 'COMMIT suo'],
      // Fermo fra due file: l'ultimo iniziato e' gia' entrato e registrato.
      ['113_revoke_public_writes_on_views.sql', '113', "e' entrato ed e' registrato"],
      ['153_il_reso_lo_apre_il_server_non_il_cliente.sql', 'rotto', 'non so dire'],
    ];
    for (const [ultimo, registrata, avviso] of casi) {
      const riepilogo = nuovoRiepilogo();
      const errore = ['psql:migrations/x.sql:3: ERROR:  relation "y" does not exist', 'riga con indirizzo postgresql://u:pw@h/d'];
      const r = esegui(bashFinto(3, [], ['111_rider_fee_cents.sql', ultimo], errore) + psqlFinto(registrata) + codice, {
        GITHUB_STEP_SUMMARY: riepilogo, SUPABASE_DB_URL: 'x', ...TETTO,
      });
      expect(r.status, `${ultimo} / ${registrata}`).toBe(3);
      const scritto = readFileSync(riepilogo, 'utf8');
      expect(scritto).toContain('- 111_rider_fee_cents.sql');
      expect(scritto).toContain(`L'ultimo file iniziato: ${ultimo}`);
      expect(scritto.slice(scritto.lastIndexOf('uscita 3')), `${ultimo} / ${registrata}`).toContain(avviso);
      // Il motivo, senza la riga con l'indirizzo.
      expect(scritto).toContain('relation "y" does not exist');
      expect(scritto).not.toContain('://');
      // Chi legge deve sapere che il database e' rimasto a meta'.
      expect(scritto).toContain("il database e' rimasto a meta'");
      // Della guardia sui contanti parla solo se e' partita la 125, 126 o 127.
      expect(scritto).not.toContain('guardia sui contanti');
    }
  });

  it('se si ferma dopo la 125, 126 o 127, dice che la guardia sui contanti e\' tolta', () => {
    const codice = passo(applica, NOME).run as string;
    const riepilogo = nuovoRiepilogo();
    const avviate = ['125_radiografia_21_agosto_bloccanti.sql', '126_radiografia_22_agosto.sql', '127_minori_22_agosto.sql', '128_x.sql'];
    const r = esegui(bashFinto(3, [], avviate) + psqlFinto('nessuna') + codice, { GITHUB_STEP_SUMMARY: riepilogo, SUPABASE_DB_URL: 'x', ...TETTO });
    expect(r.status).toBe(3);
    expect(readFileSync(riepilogo, 'utf8')).toContain('guardia sui contanti');
  });

  it('se non e\' partito nessun file, il riepilogo dice che il database non e\' stato toccato', () => {
    const codice = passo(applica, NOME).run as string;
    for (const uscita of [1, 2, 4]) {
      const riepilogo = nuovoRiepilogo();
      const r = esegui(bashFinto(uscita, [], [], ['✗ MI FERMO']) + codice, { GITHUB_STEP_SUMMARY: riepilogo, SUPABASE_DB_URL: 'x', ...TETTO });
      expect(r.status, `uscita ${uscita}`).toBe(uscita);
      const scritto = readFileSync(riepilogo, 'utf8');
      expect(scritto, `uscita ${uscita}`).toContain('- nessuna');
      expect(scritto, `uscita ${uscita}`).toContain("il database non e' stato toccato");
      expect(scritto, `uscita ${uscita}`).toContain('MI FERMO');
      expect(scritto, `uscita ${uscita}`).not.toContain("a meta'");
    }
  });

  it('se lo script arriva in fondo, il passo e\' verde e il riepilogo non parla di guasti', () => {
    const codice = passo(applica, NOME).run as string;
    for (const avviate of [['111_rider_fee_cents.sql'], []]) {
      const riepilogo = nuovoRiepilogo();
      const r = esegui(bashFinto(0, [], avviate) + codice, { GITHUB_STEP_SUMMARY: riepilogo, ...TETTO });
      expect(r.status, r.stderr).toBe(0);
      const scritto = readFileSync(riepilogo, 'utf8');
      expect(scritto).toContain(avviate.length ? '- 111_rider_fee_cents.sql' : '- nessuna');
      expect(scritto).not.toContain('si e\' fermato');
    }
  });

  it('la seconda passata non applica niente: se manca qualcosa, o non riesce a contare, si ferma', () => {
    const p = passo(applica, 'Seconda passata, non deve mancare niente');
    expect(p.env.MASSIMO_MIGRAZIONI).toBe('0');
    const codice = p.run as string;
    const riepilogo = nuovoRiepilogo();
    const ok = esegui(bashFinto(0, []) + codice, { GITHUB_STEP_SUMMARY: riepilogo });
    expect(ok.status, ok.stderr).toBe(0);
    expect(readFileSync(riepilogo, 'utf8')).toContain("non manca piu' nessuna migrazione");
    const manca = esegui(bashFinto(4, ['163_x.sql']) + codice, RIEPILOGO);
    expect(manca.status).not.toBe(0);
    expect(manca.stdout + manca.stderr).toContain('manca ancora qualcosa');
    expect(esegui(bashFinto(0, [], ['163_x.sql']) + codice, RIEPILOGO).status).not.toBe(0);
    for (const uscita of [1, 2, 3]) {
      const r = esegui(bashFinto(uscita, []) + codice, RIEPILOGO);
      expect(r.status, `uscita ${uscita}`).not.toBe(0);
      expect(r.stdout + r.stderr, `uscita ${uscita}`).toContain('Non sono riuscito a ricontare');
    }
  });

  it('i sei controlli finali chiedono quello che devono, e bocciano un esito che non e\' t|t|t|t|t|t', () => {
    const run = passo(applica, 'I sei controlli finali').run as string;
    // Al posto del database vero, un psql finto che risponde solo se la
    // domanda e' fatta come quella vera e chiede tutte e sei le cose.
    const DEVE_CHIEDERE = [
      "'public.handle_new_user()'::regprocedure", "'%''pending''%'",
      "'orders_rider_payout_status_check'", "'%HELD%'",
      "'Anyone can read active coupons'", "'Public profile read'", "'Anyone can view approved seller profiles'",
      "'Riders can view buyer of assigned orders'", "'sponsored_listings_owner_rw'", "'messages_update_read'",
      "column_name = 'product_name'", "proname = 'enqueue_order_status_email'",
      "'public.verify_delivery_code(uuid,text)'::regprocedure", "'%CASH_NOT_CONFIRMED%'",
    ];
    const cartella = cartellaNuova('sei-controlli');
    writeFileSync(join(cartella, 'deve-chiedere.txt'), DEVE_CHIEDERE.join('\n'));
    const finto = (esito: string) => `psql() {
  [[ " $* " == *" -X "* && " $* " == *" -A "* && " $* " == *" -t "* ]] || return 3
  local tutto="$*"
  while IFS= read -r pezzo; do [[ "$tutto" == *"$pezzo"* ]] || { echo "manca: $pezzo" >&2; return 4; }; done < "${cartella}/deve-chiedere.txt"
  echo '${esito}'
}
${run}`;
    const ok = esegui(finto('t|t|t|t|t|t'), { SUPABASE_DB_URL: 'x', ...RIEPILOGO });
    expect(ok.status, ok.stdout + ok.stderr).toBe(0);
    for (const male of ['t|t|t|t|t', 't|t|t|t|t|f', 't|t|f|t|t|t', 'f|t|t|t|t|t', 't|t|t|t|t|', '']) {
      expect(esegui(finto(male), { SUPABASE_DB_URL: 'x', ...RIEPILOGO }).status, `esito «${male}»`).not.toBe(0);
    }
  });

  it('i pacchetti si installano prima di scrivere, senza eseguire i loro script e senza la riga del database', () => {
    // Collaudo del 19/10: nove pacchetti hanno uno script d'installazione, che
    // potrebbe riscrivere `pg` prima che l'ultimo passo lo carichi col segreto.
    // Collaudo del 20/10: dopo la scrittura, un intoppo qui faceva rosso un
    // lavoro che aveva gia' applicato tutto.
    const installa = passo(applica, 'Installa le dipendenze');
    expect(installa.run).toBe('npm ci --legacy-peer-deps --ignore-scripts');
    expect(Object.keys(installa.env)).not.toContain('SUPABASE_DB_URL');
    expect(indice(applica, 'Installa le dipendenze')).toBeLessThan(indice(applica, NOME));
    for (const p of [...conta, ...applica]) {
      if (p.env.SUPABASE_DB_URL) expect(p.run ?? '', `«${p.name}» installa pacchetti col segreto`).not.toMatch(/npm (ci|install)/);
    }
  });

  it('alla fine confronta il registro col codice, e l\'assenza della riga del database e\' un errore', () => {
    const deriva = passo(applica, 'Il registro delle migrazioni torna col codice');
    expect(deriva.run).toBe('npm run db:check-drift');
    expect(deriva.env.SALTO_E_ERRORE).toBe('1');
    expect(deriva.env.SUPABASE_DB_URL).toBe('${{ secrets.SUPABASE_DB_URL }}');
    expect(indice(applica, 'Il registro delle migrazioni torna col codice')).toBeGreaterThan(indice(applica, 'I sei controlli finali'));
  });
});

describe('dopo un guasto, anche se il lavoro e\' stato annullato', () => {
  // Collaudo del 20/10: annullato o scaduto mentre scrive, il passo che scrive
  // non arriva a scrivere il riepilogo. L'ultimo passo riconta cosa manca.
  const p = () => passo(applica, DOPO_IL_GUASTO);

  it('e\' l\'ultimo passo, e gira solo dopo un guasto o un annullamento, se la scrittura e\' partita', () => {
    expect(applica[applica.length - 1].name).toBe(DOPO_IL_GUASTO);
    expect(p().chiavi.if).toBe("(failure() || cancelled()) && steps.scrivi.outcome != 'skipped'");
  });

  it('dice quante ne mancano ancora e con che caselle riavviare, senza scrivere niente', () => {
    const segno = join(cartellaNuova('dopo-guasto'), 'tetto');
    const finto = bashFinto(4, ['161_c.sql', '163_d.sql']).replace('bash() {', `bash() {\n  echo "\${MASSIMO_MIGRAZIONI-nessuno}" > "${segno}"`);
    const riepilogo = nuovoRiepilogo();
    const r = esegui(finto + (p().run as string), { GITHUB_STEP_SUMMARY: riepilogo });
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(segno, 'utf8').trim()).toBe('0');
    const scritto = readFileSync(riepilogo, 'utf8');
    expect(scritto).toContain('Ne mancano ancora 2');
    expect(scritto).toContain('quante = 2 e ultima = 163');
    expect(scritto).toContain('- 161_c.sql');
    expect(scritto).toContain('- 163_d.sql');
  });

  it('se non manca niente lo dice, e se non riesce a contare lo dice', () => {
    const casi: Array<[number, string]> = [[0, "Non manca piu' nessuna migrazione"], [2, 'Non sono riuscito a ricontare'], [4, 'Non sono riuscito a ricontare']];
    for (const [uscita, frase] of casi) {
      const riepilogo = nuovoRiepilogo();
      const r = esegui(bashFinto(uscita, []) + (p().run as string), { GITHUB_STEP_SUMMARY: riepilogo });
      expect(r.status, `uscita ${uscita}`).toBe(0);
      expect(readFileSync(riepilogo, 'utf8'), `uscita ${uscita}`).toContain(frase);
    }
  });
});
