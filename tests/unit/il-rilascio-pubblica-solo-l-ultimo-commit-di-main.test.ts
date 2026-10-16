/**
 * 16/10/2026 — IL RILASCIO PRENDEVA IL COMMIT DI CHIUNQUE AVESSE UNA CI VERDE SU UN RAMO CHIAMATO MAIN.
 *
 * «Rilascio dopo CI verde» parte quando finisce la CI e scarica il commit che la
 * CI ha provato. Il filtro guardava solo il NOME del ramo, e la CI gira anche
 * per le richieste di unione, comprese quelle che arrivano da copie del
 * deposito (che e' pubblico). Il lavoro di rilascio gira invece coi segreti del
 * deposito vero: il giorno in cui si accendono le chiavi di Vercel, codice mai
 * unito avrebbe girato accanto alla riga del database di produzione e al
 * gettone di Vercel.
 *
 * Accanto, un difetto gemello: rilanciare la CI di un commit VECCHIO di main
 * faceva ripartire il suo rilascio, e il codice vecchio tornava online sopra
 * quello nuovo, con la prova di fumo verde.
 *
 * Queste prove non cercano parole nel file. Fanno tre cose:
 *   ① VALUTANO le condizioni `if:` del file vero con le regole di GitHub
 *     (tests/unit/_condizioni-github.ts), per gli eventi che GitHub manderebbe;
 *   ② ESEGUONO lo script vero del passo «Il commit scaricato e' l'ultimo di main»
 *     dentro un deposito git vero, scaricato come lo scarica actions/checkout
 *     (un commit solo, senza storia: la variante scomoda);
 *   ③ con l'esito vero di quel passo, PERCORRONO i passi del lavoro e
 *     guardano quali girerebbero dopo: se il commit non viene da main, nessuno.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, chmodSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  lavoroDiRilascio,
  condizioneVera,
  eventoDopoLaCi,
  percorso,
  interpola,
  type PassoYaml,
  type EsitoFinto,
} from './_condizioni-github';

const CONTROLLO = "Il commit scaricato e' l'ultimo di main";
const VERDETTO = 'Il verdetto — cosa ho provato davvero';
const MIGRAZIONI = 'Applica le migrazioni al database, prima di pubblicare';
const RILASCIO = 'Rilascia in produzione';

const cartelle: string[] = [];
afterAll(() => {
  for (const c of cartelle) rmSync(c, { recursive: true, force: true });
});
function cartellaNuova(prefisso: string): string {
  const c = mkdtempSync(join(tmpdir(), prefisso));
  cartelle.push(c);
  return c;
}

// Un git che non legge la configurazione di chi lancia le prove (firme, alias,
// rami predefiniti): la scena deve essere la stessa su ogni computer.
const AMBIENTE_GIT: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  PATH: process.env.PATH ?? '',
  HOME: tmpdir(),
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Prova',
  GIT_AUTHOR_EMAIL: 'prova@example.invalid',
  GIT_COMMITTER_NAME: 'Prova',
  GIT_COMMITTER_EMAIL: 'prova@example.invalid',
  GIT_TERMINAL_PROMPT: '0',
};

function git(cartella: string, ...argomenti: string[]): string {
  const r = spawnSync('git', ['-C', cartella, ...argomenti], { encoding: 'utf8', env: AMBIENTE_GIT });
  if (r.status !== 0) throw new Error(`git ${argomenti.join(' ')} → ${r.status}\n${r.stderr}`);
  return r.stdout.trim();
}

function committa(cartella: string, testo: string): string {
  writeFileSync(join(cartella, 'file.txt'), testo);
  git(cartella, 'add', 'file.txt');
  git(cartella, 'commit', '-q', '-m', testo);
  return git(cartella, 'rev-parse', 'HEAD');
}

type Deposito = {
  url: string;
  /** Un commit di main, superato dal successivo. */
  vecchio: string;
  /** L'ultimo commit di main. */
  punta: string;
  /** Un commit mai unito, partito da un commit vecchio di main. */
  copiaVecchia: string;
  /** Un commit mai unito, costruito sopra l'ultimo di main: la richiesta tipica. */
  copiaSopraLaPunta: string;
};

/**
 * Il deposito su «GitHub»: main con due commit, e due commit che vivono solo
 * nei riferimenti delle richieste di unione (`refs/pull/N/head`), come quelli
 * che arrivano da una copia. Si possono scaricare per impronta, come su GitHub.
 */
function preparaDeposito(): Deposito {
  const radice = cartellaNuova('provenienza-');
  const lavoro = join(radice, 'lavoro');
  const nudo = join(radice, 'github.git');
  mkdirSync(lavoro);
  git(lavoro, 'init', '-q', '-b', 'main');
  const vecchio = committa(lavoro, 'uno');
  const punta = committa(lavoro, 'due');
  git(lavoro, 'checkout', '-q', '-b', 'dalla-copia', vecchio);
  const copiaVecchia = committa(lavoro, 'dalla copia, su un commit vecchio');
  git(lavoro, 'checkout', '-q', '-b', 'dalla-copia-2', punta);
  const copiaSopraLaPunta = committa(lavoro, 'dalla copia, sopra la punta');

  git(radice, 'init', '-q', '--bare', nudo);
  git(nudo, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
  const url = `file://${nudo}`;
  git(lavoro, 'push', '-q', url, 'main:refs/heads/main', 'dalla-copia:refs/pull/7/head', 'dalla-copia-2:refs/pull/8/head');
  return { url, vecchio, punta, copiaVecchia, copiaSopraLaPunta };
}

/** Come actions/checkout con `ref: <impronta>`: un commit solo, profondita' 1. */
function scarica(deposito: Deposito, impronta: string): string {
  const ws = cartellaNuova('workspace-');
  git(ws, 'init', '-q');
  git(ws, 'remote', 'add', 'origin', deposito.url);
  git(ws, 'fetch', '-q', '--no-tags', '--depth=1', 'origin', impronta);
  git(ws, 'checkout', '-q', '--force', '--detach', impronta);
  return ws;
}

function passoDelFile(nome: string): PassoYaml {
  const p = (lavoroDiRilascio().steps ?? []).find((s) => s.name === nome);
  if (!p) throw new Error(`Nel lavoro di rilascio non c'e' il passo «${nome}»`);
  return p;
}

type Esito = { uscita: number; output: Record<string, string>; riepilogo: string; log: string };

/** Esegue lo script vero del controllo nel workspace, con le variabili calcolate dal file. */
function controlla(ws: string, github: Record<string, unknown>): Esito {
  const p = passoDelFile(CONTROLLO);
  if (!p.run) throw new Error(`Il passo «${CONTROLLO}» non ha uno script`);
  const fuori = cartellaNuova('uscite-');
  const output = join(fuori, 'output.txt');
  const riepilogo = join(fuori, 'riepilogo.md');
  writeFileSync(output, '');
  writeFileSync(riepilogo, '');
  const daFile: Record<string, string> = {};
  for (const [k, v] of Object.entries(p.env ?? {})) daFile[k] = interpola(v, { github });
  const r = spawnSync('bash', ['-e', '-c', p.run], {
    cwd: ws,
    encoding: 'utf8',
    env: { ...AMBIENTE_GIT, ...daFile, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: riepilogo },
  });
  const uscite: Record<string, string> = {};
  for (const riga of readFileSync(output, 'utf8').split('\n')) {
    if (riga.includes('=')) uscite[riga.slice(0, riga.indexOf('='))] = riga.slice(riga.indexOf('=') + 1);
  }
  return { uscita: r.status ?? -1, output: uscite, riepilogo: readFileSync(riepilogo, 'utf8'), log: `${r.stdout}\n${r.stderr}` };
}

/**
 * Il lavoro percorso dall'inizio, con le chiavi di Vercel accese (il caso
 * peggiore: e' il giorno in cui i segreti ci sono) e l'esito VERO del controllo.
 * Restituisce i passi che girerebbero DOPO il controllo.
 */
function dopoIlControllo(github: Record<string, unknown>, controllo: Esito): string[] {
  const passi = lavoroDiRilascio().steps ?? [];
  const esiti: Record<string, EsitoFinto> = {
    'Verifica di avere le chiavi': { esito: 'success', output: { pronto: 'true' } },
    [CONTROLLO]: { esito: controllo.uscita === 0 ? 'success' : 'failure', output: controllo.output },
    [MIGRAZIONI]: { esito: 'success', output: { applicate: 'true', quante: '0' } },
    [RILASCIO]: { esito: 'success', output: { indirizzo: 'https://mycity-nuovo.vercel.app', precedente: 'https://mycity-prima.vercel.app' } },
    'Prova di fumo sul sito appena pubblicato': { esito: 'success', output: { codice: '0' } },
  };
  const girati = percorso(passi, github, esiti);
  const dove = girati.indexOf(CONTROLLO);
  if (dove < 0) throw new Error(`Nel percorso il controllo non e' girato: ${girati.join(' | ')}`);
  return girati.slice(dove + 1);
}

describe('il valutatore delle condizioni segue le regole di GitHub', () => {
  // Se il valutatore fosse piu' accomodante di GitHub, le prove qui sotto
  // potrebbero essere verdi su una condizione che GitHub legge diversamente.
  it('le stringhe si confrontano senza badare alle maiuscole', () => {
    expect(condizioneVera("github.event_name == 'PUSH'", { github: { event_name: 'push' } })).toBe(true);
  });

  it('una proprieta\' che non c\'e\' vale null, e null non e\' uguale a una parola', () => {
    expect(condizioneVera("github.event.workflow_run.event == 'push'", { github: {} })).toBe(false);
    expect(condizioneVera("steps.x.outputs.y != 'true'", { steps: {} })).toBe(true);
  });

  it('senza funzioni di stato c\'e\' un success() implicito; always() lo toglie', () => {
    const contesto = { github: { event_name: 'push' } };
    expect(condizioneVera("github.event_name == 'push'", contesto, { fallitoPrima: true })).toBe(false);
    expect(condizioneVera("always() && github.event_name == 'push'", contesto, { fallitoPrima: true })).toBe(true);
    expect(condizioneVera(undefined, contesto, { fallitoPrima: true })).toBe(false);
  });

  it('&& e || restituiscono un valore come in GitHub, con le parentesi', () => {
    const github = { a: 'x', b: '' };
    expect(condizioneVera("github.b || github.a == 'x'", { github })).toBe(true);
    expect(condizioneVera("(github.b || github.a) == 'x'", { github })).toBe(true);
    expect(condizioneVera("github.a == 'x' && (github.b == 'y' || github.b == '')", { github })).toBe(true);
  });

  it('quello che non sa valutare lo dice, non tira a indovinare', () => {
    expect(() => condizioneVera("contains(github.ref, 'main')", { github: {} })).toThrow();
    expect(() => condizioneVera('github.run_number > 3', { github: {} })).toThrow();
  });
});

describe('il lavoro di rilascio parte solo per un invio su main di questo deposito', () => {
  const se = () => lavoroDiRilascio().if;

  it('parte quando la CI di un invio su main di questo deposito e\' verde', () => {
    expect(condizioneVera(se(), { github: eventoDopoLaCi() })).toBe(true);
  });

  it('NON parte per una richiesta di unione da una copia del deposito, anche col ramo chiamato main', () => {
    const github = eventoDopoLaCi({ event: 'pull_request', headRepository: 'estraneo/mycity', headBranch: 'main' });
    expect(condizioneVera(se(), { github })).toBe(false);
  });

  // Ogni pezzo della condizione deve reggere da solo: se ne togli uno, la scena
  // che solo lui ferma deve far diventare rossa la prova.
  it('NON parte se la CI non nasce da un invio diretto, anche dallo stesso deposito', () => {
    const github = eventoDopoLaCi({ event: 'pull_request' });
    expect(condizioneVera(se(), { github })).toBe(false);
  });

  it('NON parte se il codice arriva da un altro deposito, anche come invio su un ramo main', () => {
    const github = eventoDopoLaCi({ headRepository: 'estraneo/mycity' });
    expect(condizioneVera(se(), { github })).toBe(false);
  });

  it('NON parte se il ramo non e\' main', () => {
    const github = eventoDopoLaCi({ headBranch: 'claude/lavoro' });
    expect(condizioneVera(se(), { github })).toBe(false);
  });

  it('NON parte se la CI non e\' verde', () => {
    for (const conclusion of ['failure', 'cancelled', 'skipped']) {
      expect(condizioneVera(se(), { github: eventoDopoLaCi({ conclusion }) }), conclusion).toBe(false);
    }
  });

  it('a mano parte (poi decidono i passi «A mano…» e il controllo con git)', () => {
    expect(condizioneVera(se(), { github: { event_name: 'workflow_dispatch', repository: 'NicolaeRotaru/mycity' } })).toBe(true);
  });
});

describe('il controllo con git, prima di qualunque passo con i segreti', () => {
  const deposito = preparaDeposito();

  it('la scena e\' quella vera: il checkout scarica un commit solo, senza storia', () => {
    const ws = scarica(deposito, deposito.punta);
    expect(git(ws, 'rev-parse', '--is-shallow-repository')).toBe('true');
  });

  it('l\'ultimo commit di main passa, ed e\' segnato come codice fidato', () => {
    const github = eventoDopoLaCi({ headSha: deposito.punta });
    const r = controlla(scarica(deposito, deposito.punta), github);
    expect(r.uscita, r.log).toBe(0);
    expect(r.output.fidato).toBe('true');
  });

  it('un commit mai unito, costruito sopra l\'ultimo di main, si ferma e non e\' fidato', () => {
    const github = eventoDopoLaCi({ headSha: deposito.copiaSopraLaPunta });
    const r = controlla(scarica(deposito, deposito.copiaSopraLaPunta), github);
    expect(r.uscita, r.log).not.toBe(0);
    expect(r.output.fidato).toBe('false');
    expect(r.riepilogo).toContain('non fa parte di main');
  });

  it('un commit mai unito, partito da un commit vecchio di main, si ferma e non e\' fidato', () => {
    const github = eventoDopoLaCi({ headSha: deposito.copiaVecchia });
    const r = controlla(scarica(deposito, deposito.copiaVecchia), github);
    expect(r.uscita, r.log).not.toBe(0);
    expect(r.output.fidato).toBe('false');
  });

  it('se su disco non c\'e\' il commit promosso dalla CI, si ferma', () => {
    const github = eventoDopoLaCi({ headSha: deposito.vecchio });
    const r = controlla(scarica(deposito, deposito.punta), github);
    expect(r.uscita, r.log).not.toBe(0);
    expect(r.output.fidato).toBe('false');
  });

  it('se main non si legge, si ferma: nel dubbio non pubblica', () => {
    const ws = scarica(deposito, deposito.punta);
    git(ws, 'remote', 'set-url', 'origin', `file://${join(tmpdir(), 'non-esiste-proprio.git')}`);
    const r = controlla(ws, eventoDopoLaCi({ headSha: deposito.punta }));
    expect(r.uscita, r.log).not.toBe(0);
    expect(r.output.fidato).toBe('false');
  });

  it('quando il commit non viene da main, dopo il controllo non gira NIENTE — nemmeno il verdetto', () => {
    // La condizione del lavoro e' la prima barriera; qui si prova la seconda,
    // da sola: si parte a mano su main (la condizione del lavoro e' vera) con
    // su disco un commit mai unito, e le chiavi di Vercel accese.
    const github = {
      event_name: 'workflow_dispatch',
      repository: 'NicolaeRotaru/mycity',
      ref: 'refs/heads/main',
      sha: deposito.copiaSopraLaPunta,
    };
    expect(condizioneVera(lavoroDiRilascio().if, { github })).toBe(true);
    const controllo = controlla(scarica(deposito, deposito.copiaSopraLaPunta), github);
    expect(controllo.uscita).not.toBe(0);
    expect(dopoIlControllo(github, controllo)).toEqual([]);
  });

  it('per contrasto: con l\'ultimo commit di main, dopo il controllo i passi del rilascio girano', () => {
    const github = eventoDopoLaCi({ headSha: deposito.punta });
    const dopo = dopoIlControllo(github, controlla(scarica(deposito, deposito.punta), github));
    expect(dopo).toContain(MIGRAZIONI);
    expect(dopo).toContain(RILASCIO);
    expect(dopo).toContain(VERDETTO);
  });
});

describe('prima del controllo non si esegue niente del commit scaricato', () => {
  const passi = () => lavoroDiRilascio().steps ?? [];
  const prima = () => {
    const tutti = passi();
    const dove = tutti.findIndex((p) => p.name === CONTROLLO);
    if (dove < 0) throw new Error(`Manca il passo «${CONTROLLO}»`);
    return { tutti, dove, prima: tutti.slice(0, dove) };
  };

  it('il controllo viene dopo il checkout (deve guardare il codice su disco)', () => {
    const { tutti, dove } = prima();
    const checkout = tutti.findIndex((p) => String(p.uses ?? '').startsWith('actions/checkout@'));
    expect(checkout).toBeGreaterThanOrEqual(0);
    expect(checkout).toBeLessThan(dove);
  });

  it('prima del controllo l\'unica azione esterna e\' il checkout', () => {
    const azioni = prima().prima.filter((p) => p.uses).map((p) => String(p.uses));
    expect(azioni.every((u) => u.startsWith('actions/checkout@')), azioni.join(', ')).toBe(true);
  });

  it('gli script dei passi prima del controllo, lanciati dentro un workspace pieno di trappole, non ne fanno scattare nessuna', () => {
    // Un workspace con una trappola al posto di ogni file di scripts/, e node,
    // npm, npx, vercel finti: se un passo esegue qualcosa del commit
    // scaricato, o lancia uno di quegli strumenti dentro la sua cartella, la
    // trappola scrive una riga.
    const ws = cartellaNuova('trappole-');
    const strumenti = cartellaNuova('strumenti-');
    const trappola = join(cartellaNuova('scatti-'), 'scatti.txt');
    writeFileSync(trappola, '');
    mkdirSync(join(ws, 'scripts'));
    const scatta = `#!/usr/bin/env bash\necho "scattata: $0 $*" >> "${trappola}"\nexit 0\n`;
    for (const nome of readdirSync(join(process.cwd(), 'scripts'))) {
      writeFileSync(join(ws, 'scripts', nome), scatta);
      chmodSync(join(ws, 'scripts', nome), 0o755);
    }
    for (const nome of ['node', 'npm', 'npx', 'vercel', 'psql', 'sudo']) {
      writeFileSync(join(strumenti, nome), scatta);
      chmodSync(join(strumenti, nome), 0o755);
    }
    // Il curl finto risponde «CI verde», cosi' il passo a mano va fino in fondo.
    writeFileSync(join(strumenti, 'curl'), `#!/usr/bin/env bash\necho '{"workflow_runs":[{"name":"CI","conclusion":"success","run_started_at":"2026-10-16T08:00:00Z"}]}'\n`);
    chmodSync(join(strumenti, 'curl'), 0o755);

    const contesto = {
      github: { event_name: 'workflow_dispatch', repository: 'NicolaeRotaru/mycity', ref: 'refs/heads/main', sha: 'a'.repeat(40) },
      secrets: { VERCEL_TOKEN: 't', VERCEL_ORG_ID: 'o', VERCEL_PROJECT_ID: 'p', GITHUB_TOKEN: 'g' },
    };
    const conScript = prima().prima.filter((p) => typeof p.run === 'string');
    expect(conScript.length).toBeGreaterThanOrEqual(1);
    for (const p of conScript) {
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(p.env ?? {})) env[k] = interpola(v, contesto);
      const fuori = cartellaNuova('uscite-');
      spawnSync('bash', ['-e', '-c', p.run as string], {
        cwd: ws,
        encoding: 'utf8',
        env: {
          NODE_ENV: 'test',
          PATH: `${strumenti}:${process.env.PATH ?? ''}`,
          HOME: tmpdir(),
          ...env,
          GITHUB_OUTPUT: join(fuori, 'o'),
          GITHUB_STEP_SUMMARY: join(fuori, 'r'),
        },
      });
    }
    expect(readFileSync(trappola, 'utf8')).toBe('');
  });
});

describe('rilanciare la CI di un commit vecchio di main non lo rimette in produzione', () => {
  const deposito = preparaDeposito();
  // Il rilancio di una CI su un commit vecchio di main manda lo stesso evento
  // di una CI nuova: invio diretto, questo deposito, ramo main, verde.
  const github = eventoDopoLaCi({ headSha: deposito.vecchio });

  it('l\'evento del rilancio passa la condizione del lavoro: e\' il controllo con git a doverlo fermare', () => {
    expect(condizioneVera(lavoroDiRilascio().if, { github })).toBe(true);
  });

  it('il commit vecchio si riconosce anche senza storia, si ferma e dice qual e\' il piu\' nuovo', () => {
    const ws = scarica(deposito, deposito.vecchio);
    expect(git(ws, 'rev-parse', '--is-shallow-repository')).toBe('true');
    const r = controlla(ws, github);
    expect(r.uscita, r.log).not.toBe(0);
    expect(r.riepilogo).toContain('commit piu\' nuovo');
    expect(r.riepilogo).toContain(deposito.punta);
    // E' codice gia' unito: il verdetto puo' girare e dirlo.
    expect(r.output.fidato).toBe('true');
  });

  it('dopo il controllo non girano ne\' le migrazioni ne\' la pubblicazione: solo il verdetto', () => {
    const dopo = dopoIlControllo(github, controlla(scarica(deposito, deposito.vecchio), github));
    expect(dopo).toEqual([VERDETTO]);
  });
});
