/**
 * 19/10/2026 — IL PULSANTE CHE SCRIVE SUL DATABASE DI PRODUZIONE.
 *
 * `.github/workflows/migrazioni-a-mano.yml` applica al database vero le
 * migrazioni che mancano, in due lavori: uno conta senza scrivere, l'altro
 * scrive. Prima di scrivere deve fermarsi quando chi lo avvia non ha scritto
 * APPLICA, quando le migrazioni che mancano non sono quelle attese (quante e
 * quale e' l'ultima), quando la riga del database non e' quella del Session
 * pooler, quando sta girando la copia del database e quando su main i file
 * sono cambiati dopo l'avvio.
 *
 * Queste prove non cercano parole nel file: prendono il pezzo di shell vero
 * dal lavoro (o lo script che il lavoro chiama) e lo eseguono come lo esegue
 * GitHub (`bash -e`), con i valori che una persona puo' scrivere. Al posto
 * dello script delle migrazioni, di psql e di gh ci sono dei finti, che
 * rispondono come rispondono quelli veri; git e jq sono quelli veri.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
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
const esegui = (codice: string, env: Record<string, string>, cwd?: string) =>
  spawnSync('bash', ['-e', '-c', codice], { encoding: 'utf8', env: { ...process.env, ...env }, cwd });

// Un `bash` finto al posto dello script delle migrazioni: stampa quello che
// stampa lo script vero ed esce col codice che gli diamo.
const bashFinto = (uscita: number, mancano: string[], applicate: string[] = [], errore: string[] = []) => `bash() {
  ${applicate.map((f) => `echo "▶ applico ${f}"`).join('; ') || ':'}
  ${errore.map((e) => `echo '${e}' >&2`).join('; ') || ':'}
  ${mancano.length ? `echo "  Quelle che mancano:" >&2; ${mancano.map((f) => `echo "    - ${f}" >&2`).join('; ')}` : ':'}
  return ${uscita}
}
`;
const RIEPILOGO = { GITHUB_STEP_SUMMARY: '/dev/null' };
const nuovoRiepilogo = () => join(mkdtempSync(join(tmpdir(), 'migrazioni-a-mano-')), 'riepilogo.md');
// Lo script del conto lanciato come lo lancia il lavoro (`bash scripts/...`,
// un processo a parte): il `bash` finto gli arriva esportato.
const contaCon = (finto: string, env: Record<string, string>) =>
  esegui(`${finto}\nexport -f bash\ncommand bash scripts/conta-migrazioni-mancanti.sh`, { ...RIEPILOGO, ...env });

describe('chi puo\' avviarlo, e quando', () => {
  it('si avvia soltanto a mano, con tre caselle obbligatorie', () => {
    const on = testo.slice(testo.indexOf('\non:'), testo.indexOf('\npermissions:'));
    expect(on).toContain('workflow_dispatch:');
    expect(on).not.toMatch(/^\s+(push|pull_request|schedule|workflow_run):/m);
    for (const casella of ['conferma', 'quante', 'ultima']) {
      expect(on, `la casella «${casella}» non e' obbligatoria`).toMatch(new RegExp(`${casella}:[^]*?required: true`));
    }
  });

  it('tutti e due i lavori girano solo da main, e nessun freno si puo\' saltare', () => {
    for (const nome of ['conta', 'applica'] as const) {
      const chiavi = chiaviDelLavoro(nome);
      expect(chiavi.if, `il lavoro «${nome}»`).toBe("github.ref == 'refs/heads/main'");
      expect(chiavi, `il lavoro «${nome}»`).not.toHaveProperty('continue-on-error');
    }
    // Un passo con `if:` o `continue-on-error:` e' un freno che puo' non
    // scattare; e un `shell:` diverso cambierebbe il modo in cui si ferma.
    for (const p of [...conta, ...applica]) {
      for (const vietata of ['if', 'continue-on-error', 'shell']) {
        expect(p.chiavi, `il passo «${p.name}» ha «${vietata}:»`).not.toHaveProperty(vietata);
      }
    }
  });

  it('il lavoro che scrive parte solo dopo quello che conta, ed e\' l\'unico nell\'ambiente da approvare', () => {
    expect(chiaviDelLavoro('applica').needs).toBe('conta');
    expect(chiaviDelLavoro('applica').environment).toBe('database-produzione');
    // Se l'ambiente stesse sul conto, Nicola approverebbe prima di vedere l'elenco.
    expect(chiaviDelLavoro('conta')).not.toHaveProperty('environment');
  });

  it('il lavoro che scrive si mette in fila col rilascio automatico, che applica gli stessi file', () => {
    // Collaudo del 19/10: con due gruppi diversi, un'unione su main durante il
    // lavoro faceva entrare due volte dieci migrazioni.
    const proprio = lavoro('applica').match(/concurrency:\n\s+group: (\S+)/)?.[1];
    const rilascio = readFileSync(join(process.cwd(), '.github/workflows/deploy-dopo-ci.yml'), 'utf8')
      .match(/^concurrency:\n\s+group: (\S+)/m)?.[1];
    expect(rilascio).toBeDefined();
    expect(proprio).toBe(rilascio);
  });

  it('la conferma viene prima di qualunque altro passo, e senza APPLICA si ferma', () => {
    expect(conta[0].name).toBe('La conferma scritta');
    const codice = conta[0].run as string;
    for (const sbagliata of ['', 'applica', 'APPLICA ', 'si', 'vai']) {
      expect(esegui(codice, { CONFERMA: sbagliata }).status, `ha accettato «${sbagliata}»`).not.toBe(0);
    }
    expect(esegui(codice, { CONFERMA: 'APPLICA' }).status).toBe(0);
  });

  it('quello che si scrive nelle caselle passa da variabili, non incollato nei comandi', () => {
    for (const p of [...conta, ...applica]) {
      if (p.run) expect(p.run, `il passo «${p.name}» incolla un valore nel comando`).not.toMatch(/\$\{\{\s*inputs\./);
    }
  });
});

describe('non mentre gira la copia del database', () => {
  const NOME = 'Non mentre gira la copia del database';
  // Un `gh` finto che risponde con le esecuzioni che gli diamo, passate dal
  // filtro `--jq` vero del passo (con jq vero). Se il passo chiede altro che
  // l'elenco delle esecuzioni di backup-db.yml, risponde con un errore.
  const ghFinto = (esecuzioni: string, uscita = 0) => `gh() {
  local filtro="" tutto="$*"
  [[ "$tutto" == *"run list"* && "$tutto" == *"--workflow backup-db.yml"* ]] || { echo "chiamata inattesa: $tutto" >&2; return 9; }
  while [ $# -gt 0 ]; do [ "$1" = "--jq" ] && filtro="$2"; shift; done
  [ ${uscita} = 0 ] || return ${uscita}
  echo '${esecuzioni}' | jq -r "$filtro"
}
`;
  const ENV = { GITHUB_REPOSITORY: 'NicolaeRotaru/mycity', GH_TOKEN: 'x' };

  it('nei due lavori, si ferma se una copia sta girando o e\' in coda, e se non riesce a vederlo', () => {
    for (const passi of [conta, applica]) {
      const codice = passo(passi, NOME).run as string;
      for (const libero of ['[]', '[{"status":"completed"},{"status":"completed"}]']) {
        const r = esegui(ghFinto(libero) + codice, ENV);
        expect(r.status, `con ${libero}: ${r.stdout}${r.stderr}`).toBe(0);
      }
      for (const stato of ['queued', 'in_progress', 'waiting', 'requested', 'pending']) {
        const r = esegui(ghFinto(`[{"status":"completed"},{"status":"${stato}"}]`) + codice, ENV);
        expect(r.status, `con una copia «${stato}»`).not.toBe(0);
      }
      expect(esegui(ghFinto('[]', 1) + codice, ENV).status, 'gh non risponde').not.toBe(0);
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
  // Un main con un commit, e una copia fatta come la fa actions/checkout: un
  // commit solo, preso con un fetch, che lascia FETCH_HEAD sul commit di
  // partenza. Poi su main succede `dopo`, e nella copia gira il passo.
  const scenario = (codice: string, dopo: (main: string) => void) => {
    const base = mkdtempSync(join(tmpdir(), 'ancora-main-'));
    const main = join(base, 'main');
    mkdirSync(join(main, 'migrations'), { recursive: true });
    mkdirSync(join(main, 'scripts'));
    writeFileSync(join(main, 'migrations', '164_prova.sql'), 'select 1;\n');
    writeFileSync(join(main, 'scripts', 'applica-migrazioni-mancanti.sh'), 'echo uno\n');
    writeFileSync(join(main, 'README.md'), 'uno\n');
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

  it('nei due lavori, va avanti se su main non e\' cambiato niente che conti', () => {
    for (const passi of [conta, applica]) {
      const codice = passo(passi, NOME).run as string;
      const fermo = scenario(codice, () => {});
      expect(fermo.status, fermo.stdout + fermo.stderr).toBe(0);
      const altro = scenario(codice, (m) => { writeFileSync(join(m, 'README.md'), 'due\n'); committa(m); });
      expect(altro.status, altro.stdout + altro.stderr).toBe(0);
    }
  });

  it('nei due lavori, si ferma se su main una migrazione o lo script sono cambiati, o se main non si legge', () => {
    for (const passi of [conta, applica]) {
      const codice = passo(passi, NOME).run as string;
      const casi: Record<string, (m: string) => void> = {
        'migrazione corretta': (m) => { writeFileSync(join(m, 'migrations', '164_prova.sql'), 'select 2;\n'); committa(m); },
        'migrazione tolta': (m) => { rmSync(join(m, 'migrations', '164_prova.sql')); committa(m); },
        'migrazione aggiunta': (m) => { writeFileSync(join(m, 'migrations', '165_nuova.sql'), 'select 3;\n'); committa(m); },
        'script cambiato': (m) => { writeFileSync(join(m, 'scripts', 'applica-migrazioni-mancanti.sh'), 'echo due\n'); committa(m); },
        'main sparito': (m) => { rmSync(m, { recursive: true, force: true }); },
      };
      for (const [caso, dopo] of Object.entries(casi)) {
        expect(scenario(codice, dopo).status, caso).not.toBe(0);
      }
    }
  });

  it('nel lavoro che scrive viene prima del conto e della scrittura', () => {
    expect(indice(applica, NOME)).toBeLessThan(indice(applica, 'Riconta subito prima di scrivere'));
    expect(indice(conta, NOME)).toBeLessThan(indice(conta, 'Conta quelle che mancano'));
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
  const ghFinto = (ambiente: string, uscita = 0) => `gh() {
  local filtro="" tutto="$*"
  [[ "$tutto" == *"api repos/NicolaeRotaru/mycity/environments/database-produzione"* ]] || { echo "chiamata inattesa: $tutto" >&2; return 9; }
  while [ $# -gt 0 ]; do [ "$1" = "--jq" ] && filtro="$2"; shift; done
  [ ${uscita} = 0 ] || return ${uscita}
  echo '${ambiente}' | jq -r "$filtro"
}
`;

  it('dice se il secondo lavoro aspetta, e non ferma mai il conto', () => {
    const codice = passo(conta, NOME).run as string;
    const casi: Array<[string, number, string]> = [
      ['{"protection_rules":[{"type":"wait_timer"},{"type":"required_reviewers"}]}', 0, 'aspetta il tuo'],
      ['{"protection_rules":[]}', 0, 'non chiede'],
      ['{"name":"database-produzione"}', 0, 'non chiede'],
      ['{"protection_rules":[{"type":"branch_policy"}]}', 0, 'non chiede'],
      ['', 1, 'Non sono riuscito'],
    ];
    for (const [ambiente, uscita, frase] of casi) {
      const riepilogo = nuovoRiepilogo();
      const r = esegui(ghFinto(ambiente, uscita) + codice, {
        GITHUB_REPOSITORY: 'NicolaeRotaru/mycity', GH_TOKEN: 'x', GITHUB_STEP_SUMMARY: riepilogo,
      });
      expect(r.status, `${ambiente}: ${r.stderr}`).toBe(0);
      expect(readFileSync(riepilogo, 'utf8'), ambiente).toContain(frase);
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

  it('chiede allo script delle migrazioni di fermarsi prima di scrivere (tetto 0)', () => {
    const segno = join(mkdtempSync(join(tmpdir(), 'tetto-')), 'tetto');
    // Il `bash` finto annota il tetto con cui e' stato chiamato.
    const finto = `bash() { echo "\${MASSIMO_MIGRAZIONI-nessuno}" > "${segno}"; return 0; }\n`;
    expect(contaCon(finto, { QUANTE: '0', ULTIMA: '163' }).status).toBe(0);
    expect(readFileSync(segno, 'utf8').trim()).toBe('0');
  });

  it('va avanti solo se ne mancano quante ne aspetti, e l\'ultima e\' quella attesa', () => {
    const giusto = contaCon(bashFinto(4, elenco), { QUANTE: '4', ULTIMA: '163' });
    expect(giusto.status, giusto.stdout + giusto.stderr).toBe(0);
    for (const quante of ['3', '5', '48', '04', '']) {
      expect(contaCon(bashFinto(4, elenco), { QUANTE: quante, ULTIMA: '163' }).status, `quante «${quante}»`).not.toBe(0);
    }
    // Il numero torna, ma l'ultima no: 47 attese piu' una sconosciuta fanno 48 lo stesso.
    for (const ultima of ['161', '164', '16', 'tutte', '']) {
      expect(contaCon(bashFinto(4, elenco), { QUANTE: '4', ULTIMA: ultima }).status, `ultima «${ultima}»`).not.toBe(0);
    }
  });

  it('una casella scritta male ferma il conto prima ancora di chiedere al database', () => {
    const segno = join(mkdtempSync(join(tmpdir(), 'conto-')), 'chiamato');
    // Il `bash` finto lascia un segno se viene chiamato: qui non deve esserlo mai.
    const finto = `bash() { touch "${segno}"; return 0; }\n`;
    const casi: Array<[string, string]> = [
      ['', '163'], ['4x', '163'], [' 4', '163'], ['-1', '163'],
      ['0', ''], ['0', '16'], ['0', '1634'], ['0', 'tutte'], ['0', '163_'],
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
      '✗ non riesco a collegarmi al database: nessuna migrazione applicata.',
      '  Il database risponde, ma rifiuta utente o password.',
    ];
    const r = contaCon(bashFinto(1, [], [], errore), { QUANTE: '48', ULTIMA: '163', GITHUB_STEP_SUMMARY: riepilogo });
    expect(r.status).not.toBe(0);
    const scritto = readFileSync(riepilogo, 'utf8');
    expect(scritto).toContain('non riesco a collegarmi al database');
    expect(scritto).toContain('rifiuta utente o password');
    // Una riga con un indirizzo non passa mai nel riepilogo.
    expect(scritto).not.toContain('pezzo-di-password');
    expect(scritto).not.toContain('://');
  });
});

describe('quello che fa il lavoro che scrive', () => {
  it('applica con lo script del rilascio, e il tetto e\' il numero contato', () => {
    const p = passo(applica, 'Applica le migrazioni che mancano');
    expect(p.run).toContain('bash scripts/applica-migrazioni-mancanti.sh');
    expect(p.env.MASSIMO_MIGRAZIONI).toBe('${{ inputs.quante }}');
  });

  it('se lo script si ferma a meta\', il passo fallisce e il riepilogo dice cosa e\' entrato e dove si e\' fermato', () => {
    const codice = passo(applica, 'Applica le migrazioni che mancano').run as string;
    // Un psql finto che risponde «registrata» solo per la versione che gli
    // diamo; con «rotto», non risponde affatto.
    const psqlFinto = (registrata: string) => registrata === 'rotto'
      ? 'psql() { return 2; }\n'
      : `psql() { [[ "$*" == *"version = '${registrata}'"* ]] && echo 1; return 0; }\n`;
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
      const r = esegui(bashFinto(3, [], ['111_rider_fee_cents.sql', ultimo]) + psqlFinto(registrata) + codice, {
        GITHUB_STEP_SUMMARY: riepilogo, SUPABASE_DB_URL: 'x',
      });
      expect(r.status, `${ultimo} / ${registrata}`).toBe(3);
      const scritto = readFileSync(riepilogo, 'utf8');
      expect(scritto).toContain('- 111_rider_fee_cents.sql');
      expect(scritto).toContain(`L'ultimo file iniziato: ${ultimo}`);
      expect(scritto.slice(scritto.lastIndexOf('uscita 3')), `${ultimo} / ${registrata}`).toContain(avviso);
      // Chi legge deve sapere che il database e' rimasto a meta'.
      expect(scritto).toContain('la 163 rimette');
    }
  });

  it('se lo script arriva in fondo, il passo e\' verde e il riepilogo non parla di guasti', () => {
    const codice = passo(applica, 'Applica le migrazioni che mancano').run as string;
    const riepilogo = nuovoRiepilogo();
    const r = esegui(bashFinto(0, [], ['111_rider_fee_cents.sql']) + codice, { GITHUB_STEP_SUMMARY: riepilogo });
    expect(r.status, r.stderr).toBe(0);
    const scritto = readFileSync(riepilogo, 'utf8');
    expect(scritto).toContain('- 111_rider_fee_cents.sql');
    expect(scritto).not.toContain('si e\' fermato');
  });

  it('la seconda passata non applica niente: se manca qualcosa si ferma', () => {
    const p = passo(applica, 'Seconda passata, non deve mancare niente');
    expect(p.env.MASSIMO_MIGRAZIONI).toBe('0');
    const codice = p.run as string;
    expect(esegui(bashFinto(0, []) + codice, {}).status).toBe(0);
    expect(esegui(bashFinto(4, ['163_x.sql']) + codice, {}).status).not.toBe(0);
    expect(esegui(bashFinto(0, [], ['163_x.sql']) + codice, {}).status).not.toBe(0);
  });

  it('i controlli del passo 3 bocciano un esito che non e\' t|t|t|t|t', () => {
    const run = passo(applica, 'I cinque controlli del passo 3').run as string;
    // Al posto del database vero, un psql finto che risponde come vogliamo.
    const finto = (esito: string) => `psql() { echo '${esito}'; }\n${run}`;
    const ok = esegui(finto('t|t|t|t|t'), { SUPABASE_DB_URL: 'x', ...RIEPILOGO });
    expect(ok.status, ok.stdout + ok.stderr).toBe(0);
    for (const male of ['t|t|f|t|t', 'f|t|t|t|t', 't|t|t|t|', '']) {
      expect(esegui(finto(male), { SUPABASE_DB_URL: 'x', ...RIEPILOGO }).status, `esito «${male}»`).not.toBe(0);
    }
  });

  it('i pacchetti si installano senza eseguire i loro script, e senza la riga del database', () => {
    // Collaudo del 19/10: nove pacchetti hanno uno script d'installazione, che
    // potrebbe riscrivere `pg` prima che il passo dopo lo carichi col segreto.
    const installa = passo(applica, 'Installa le dipendenze');
    expect(installa.run).toMatch(/^npm ci( \S+)* --ignore-scripts( |$)/);
    expect(Object.keys(installa.env)).not.toContain('SUPABASE_DB_URL');
    for (const p of [...conta, ...applica]) {
      if (p.env.SUPABASE_DB_URL) expect(p.run ?? '', `«${p.name}» installa pacchetti col segreto`).not.toMatch(/npm (ci|install)/);
    }
  });
});
