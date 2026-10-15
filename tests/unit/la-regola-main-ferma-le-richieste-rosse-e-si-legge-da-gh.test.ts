/**
 * 15/10/2026 (R57 e K45, secondo collaudo) — LA REGOLA «MAIN» SI CONTROLLA COL
 * COMANDO CHE NICOLA LANCIA DAVVERO, E DICE IL VERO SU COSA FERMA.
 *
 * Due difetti del giro precedente, trovati dal collaudo e verificati sul codice:
 *
 * ① Il comando delle istruzioni, `gh api … | node scripts/controlla-regola-main.mjs`,
 *   usciva SEMPRE 2 («non ho potuto leggere la regola»). Lo script toccava
 *   `process.stdin.isTTY`, che mette la pipe in modalita' non bloccante, e poi
 *   `readFileSync(0)` lanciava EAGAIN finche' `gh` aspettava la rete. Le prove
 *   passavano perche' davano l'ingresso tutto insieme prima che node leggesse.
 *   Qui l'ingresso arriva come lo manda `gh`: IN RITARDO, e in PIU' PEZZI.
 *
 * ② Lo script diceva che senza la spunta «Require branches to be up to date
 *   before merging» la regola NON ferma il codice rosso, e citava il 1/9 come
 *   prova. Il 1/9 era un'altra cosa: la CI di main e' finita rossa alle
 *   18:11:32 su una prova che si rompeva da sola nei minuti :10-:11 di ogni ora
 *   (commit 94e56c6), mentre la #245 toccava solo due componenti e il file dei
 *   pacchetti. Senza la spunta la regola ferma lo stesso OGNI richiesta rossa:
 *   la spunta e' una scelta con un costo, e un rosso che compare su main dopo
 *   l'unione non lo ferma nessuna regola sulle richieste.
 *
 * Le prove passano la regola — quella di oggi, letta da GitHub, e le sue
 * varianti — alla funzione e allo script veri.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  valutaLaRegolaMain,
  righeDelVerdetto,
  esitoDalTesto,
  CONTROLLO_RICHIESTO,
} from '@/scripts/controlla-regola-main.mjs';

/**
 * La regola com'e' su GitHub il 15/10/2026: risposta vera di
 * `gh api repos/NicolaeRotaru/mycity/rulesets/16879481`, senza i link.
 */
const REGOLA_DI_OGGI = {
  id: 16879481,
  name: 'Main',
  target: 'branch',
  source_type: 'Repository',
  source: 'NicolaeRotaru/mycity',
  enforcement: 'disabled',
  conditions: { ref_name: { exclude: [], include: [] } },
  rules: [
    { type: 'deletion' },
    { type: 'non_fast_forward' },
    {
      type: 'required_status_checks',
      parameters: {
        strict_required_status_checks_policy: false,
        do_not_enforce_on_create: false,
        required_status_checks: [{ context: 'Main' }],
      },
    },
  ],
  created_at: '2026-05-26T13:59:28.273Z',
  updated_at: '2026-05-26T13:59:28.302Z',
  bypass_actors: [],
  current_user_can_bypass: 'never',
};

type Regola = typeof REGOLA_DI_OGGI & Record<string, unknown>;

function copia(): Regola {
  return JSON.parse(JSON.stringify(REGOLA_DI_OGGI));
}

/** I parametri della regola dei controlli, da modificare in una copia. */
function controlli(regola: Regola) {
  const r = regola.rules.find((x) => x.type === 'required_status_checks') as {
    parameters: { strict_required_status_checks_policy: boolean; required_status_checks: Record<string, unknown>[] };
  };
  return r.parameters;
}

/** La regola coi passi obbligatori: accesa, su main, «Main». La spunta del ramo aggiornato resta tolta. */
function sistemata(): Regola {
  const r = copia();
  r.enforcement = 'active';
  r.conditions.ref_name.include = ['~DEFAULT_BRANCH'] as never[];
  return r;
}

/** La stessa, con in piu' la spunta del ramo aggiornato (la scelta facoltativa). */
function sistemataConLaSpunta(): Regola {
  const r = sistemata();
  controlli(r).strict_required_status_checks_policy = true;
  return r;
}

const cartelle: string[] = [];
afterAll(() => {
  for (const c of cartelle) rmSync(c, { recursive: true, force: true });
});

/** Una cartella temporanea che si butta alla fine, con dentro la regola in un file. */
function fileDellaRegola(regola: unknown): string {
  const cartella = mkdtempSync(join(tmpdir(), 'regola-main-'));
  cartelle.push(cartella);
  const file = join(cartella, 'regola.json');
  writeFileSync(file, JSON.stringify(regola));
  return file;
}

/**
 * Lo script vero, lanciato da una shell vera con una pipe vera davanti, come
 * nelle istruzioni: `<produttore> | node scripts/controlla-regola-main.mjs`. Il
 * produttore fa la parte di `gh api`, che scrive solo dopo aver sentito la rete.
 */
function inPipe(produttore: string, env: Record<string, string> = {}) {
  const esito = spawnSync('bash', ['-c', `${produttore} | "$NODO" scripts/controlla-regola-main.mjs`], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 30_000,
    env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '', NODO: process.execPath, ...env },
  });
  return { uscita: esito.status ?? -1, testo: `${esito.stdout}\n${esito.stderr}` };
}

describe('la regola «Main»: cosa le manca per fermare le richieste rosse', () => {
  it('la regola di oggi non ferma niente: e\' spenta e non guarda nessun ramo', () => {
    const esito = valutaLaRegolaMain(REGOLA_DI_OGGI);
    expect(esito.letta).toBe(true);
    expect(esito.protegge).toBe(false);
    const cose = esito.mancano.map((m) => m.cosa).join('\n');
    expect(cose).toContain('spenta');
    expect(cose).toContain('non guarda nessun ramo');
    expect(esito.mancano).toHaveLength(2);
    expect(esito.ramoAggiornato).toBe(false);
  });

  it('accesa, su main, con «Main»: ferma le richieste rosse anche SENZA la spunta del ramo aggiornato', () => {
    const esito = valutaLaRegolaMain(sistemata());
    expect(esito.mancano).toEqual([]);
    expect(esito.protegge).toBe(true);
    // La spunta non e' un pezzo che manca: e' una scelta, che si dice col suo costo.
    expect(esito.ramoAggiornato).toBe(false);
    const avvisi = esito.avvisi.join('\n');
    expect(avvisi).toContain('Require branches to be up to date before merging');
    expect(avvisi).toContain('Update branch');
  });

  it('il 1/9 non viene piu\' usato come prova della spunta: era una prova che si rompeva da sola', () => {
    // Il racconto falso del giro precedente: «la #245, verde da sola, si e'
    // unita sopra un main cambiato». Nessuna riga che lo script stampa deve
    // ripeterlo, ne' con la spunta ne' senza.
    for (const regola of [REGOLA_DI_OGGI, sistemata(), sistemataConLaSpunta()]) {
      const testo = righeDelVerdetto(valutaLaRegolaMain(regola)).join('\n');
      expect(testo).not.toContain('#245');
      expect(testo).not.toContain('#246');
    }
  });

  it('anche col ✅ dice cosa la regola NON ferma: un rosso che compare su main dopo l\'unione', () => {
    for (const regola of [sistemata(), sistemataConLaSpunta()]) {
      const esito = valutaLaRegolaMain(regola);
      expect(esito.protegge).toBe(true);
      const avvisi = esito.avvisi.join('\n');
      expect(avvisi).toContain('DOPO l\'unione');
      expect(avvisi).toContain('"main": false');
    }
  });

  it('con la spunta del ramo aggiornato protegge lo stesso, e ne dice il costo', () => {
    const esito = valutaLaRegolaMain(sistemataConLaSpunta());
    expect(esito.protegge).toBe(true);
    expect(esito.ramoAggiornato).toBe(true);
    expect(esito.avvisi.join('\n')).toContain('Update branch');
  });

  it('«Evaluate» non e\' acceso: registra ma non ferma', () => {
    const r = sistemata();
    r.enforcement = 'evaluate';
    const esito = valutaLaRegolaMain(r);
    expect(esito.protegge).toBe(false);
    expect(esito.mancano[0].cosa).toContain('Evaluate');
  });

  it('main escluso, o un ramo che non e\' main, non protegge main', () => {
    const escluso = sistemata();
    escluso.conditions.ref_name.exclude = ['refs/heads/main'] as never[];
    expect(valutaLaRegolaMain(escluso).protegge).toBe(false);

    const altroRamo = sistemata();
    altroRamo.conditions.ref_name.include = ['refs/heads/sviluppo'] as never[];
    expect(valutaLaRegolaMain(altroRamo).protegge).toBe(false);

    for (const bersaglio of ['~DEFAULT_BRANCH', '~ALL', 'refs/heads/main']) {
      const r = sistemata();
      r.conditions.ref_name.include = [bersaglio] as never[];
      expect(valutaLaRegolaMain(r).protegge, bersaglio).toBe(true);
    }
  });

  it('una regola sulle etichette (tag), anche con «tutti», non guarda il ramo main', () => {
    // Collaudo del 15/10: togliendo la condizione sul tipo di bersaglio, una
    // regola sulle etichette con ~ALL veniva contata come «guarda main».
    for (const target of ['tag', 'push']) {
      const r = sistemata();
      r.target = target;
      r.conditions.ref_name.include = ['~ALL'] as never[];
      const esito = valutaLaRegolaMain(r);
      expect(esito.protegge, target).toBe(false);
      expect(esito.mancano.map((m) => m.cosa).join('\n')).toContain('non guarda il ramo main');
    }
  });

  it('una regola che pretende un altro nome al posto di «Main» non protegge', () => {
    const r = sistemata();
    controlli(r).required_status_checks = [{ context: 'Unit tests' }];
    const esito = valutaLaRegolaMain(r);
    expect(esito.protegge).toBe(false);
    expect(esito.mancano.map((m) => m.cosa).join('\n')).toContain(`«${CONTROLLO_RICHIESTO}»`);
  });

  it('senza la regola dei controlli non protegge, e la spunta non si conta ne\' messa ne\' tolta', () => {
    const r = sistemataConLaSpunta();
    r.rules = r.rules.filter((x) => x.type !== 'required_status_checks');
    const esito = valutaLaRegolaMain(r);
    expect(esito.protegge).toBe(false);
    expect(esito.ramoAggiornato).toBeNull();
  });

  it('«Main» chiesto a un\'app che non e\' GitHub Actions non vale; da GitHub Actions si\'', () => {
    const altraApp = sistemata();
    controlli(altraApp).required_status_checks = [{ context: 'Main', integration_id: 999 }];
    expect(valutaLaRegolaMain(altraApp).protegge).toBe(false);

    const actions = sistemata();
    controlli(actions).required_status_checks = [{ context: 'Main', integration_id: 15368 }];
    expect(valutaLaRegolaMain(actions).protegge).toBe(true);
  });

  it('la coda di unione blocca tutto: ci.yml non gira su merge_group, «Main» non arriverebbe mai', () => {
    for (const r of [sistemata(), sistemataConLaSpunta()]) {
      r.rules.push({ type: 'merge_queue' } as never);
      const esito = valutaLaRegolaMain(r);
      expect(esito.protegge).toBe(false);
      expect(esito.mancano.map((m) => m.come).join('\n')).toContain('merge_group');
    }
  });

  it('chi puo\' scavalcarla lo dice, senza nasconderlo e senza bocciare la regola', () => {
    const conPorta = sistemata();
    conPorta.bypass_actors = [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }] as never[];
    const esito = valutaLaRegolaMain(conPorta);
    expect(esito.protegge).toBe(true);
    expect(esito.avvisi.join('\n')).toContain('scavalcarla');

    const senzaElenco = sistemata() as Record<string, unknown>;
    delete senzaElenco.bypass_actors;
    expect(valutaLaRegolaMain(senzaElenco).avvisi.join('\n')).toContain('non vedo chi');
  });

  it('una risposta che non e\' una regola non diventa mai un verde', () => {
    for (const cosa of [null, undefined, {}, [], 'testo', { message: 'Not Found' }, { rules: 'no' }]) {
      const esito = valutaLaRegolaMain(cosa);
      expect(esito.letta, JSON.stringify(cosa)).toBe(false);
      expect(esito.protegge).toBe(false);
    }
    expect(righeDelVerdetto(valutaLaRegolaMain({ message: 'Not Found' })).join('\n')).toContain('Not Found');
  });

  it('un ingresso vuoto o che non e\' JSON e\' un «non lo so» che dice perche\'', () => {
    const vuoto = esitoDalTesto('  \n');
    expect(vuoto.letta).toBe(false);
    expect(vuoto.motivo).toContain('Non mi e\' arrivato niente');
    const storto = esitoDalTesto('gh: Not Found (HTTP 404)');
    expect(storto.letta).toBe(false);
    expect(storto.motivo).toContain('non e\' JSON');
    expect(esitoDalTesto(JSON.stringify(sistemata())).protegge).toBe(true);
  });
});

// Ogni prova lancia una shell e node, e aspetta un secondo il produttore: sotto
// il carico dell'intera suite i cinque secondi di default non bastano.
describe('lo script vero, col comando delle istruzioni: `gh api … | node scripts/controlla-regola-main.mjs`', { timeout: 60_000 }, () => {
  it('la risposta arriva in ritardo, come quella di gh che aspetta la rete: la legge lo stesso', () => {
    const file = fileDellaRegola(REGOLA_DI_OGGI);
    const { uscita, testo } = inPipe('(sleep 1; cat "$FILE")', { FILE: file });
    expect(uscita, testo).toBe(1);
    expect(testo).toContain('NON ferma le richieste con la CI rossa');
    expect(testo).not.toContain('Non ho potuto leggere');
  });

  it('la risposta arriva in due pezzi con una pausa in mezzo: la legge tutta, non solo il primo', () => {
    const file = fileDellaRegola(sistemata());
    const { uscita, testo } = inPipe('(head -c 150 "$FILE"; sleep 1; tail -c +151 "$FILE")', { FILE: file });
    expect(uscita, testo).toBe(0);
    expect(testo).toContain('✅');
  });

  it('sulla regola sistemata, senza la spunta del ramo aggiornato, esce 0 e la spunta resta una scelta', () => {
    const file = fileDellaRegola(sistemata());
    const { uscita, testo } = inPipe('(sleep 1; cat "$FILE")', { FILE: file });
    expect(uscita, testo).toBe(0);
    expect(testo).toContain('Require branches to be up to date before merging');
    expect(testo).toContain('scelta tua');
  });

  it('se gh fallisce e non scrive niente, esce 2 e dice di guardare l\'errore di gh', () => {
    const { uscita, testo } = inPipe('(sleep 1; echo "gh: HTTP 401: Bad credentials" >&2; exit 1)');
    expect(uscita, testo).toBe(2);
    expect(testo).toContain('Non mi e\' arrivato niente');
  });

  it('su una risposta illeggibile o di errore esce 2: un «non lo so», non un verde', () => {
    for (const ingresso of ['non e\' JSON', '{"message":"Not Found"}', 'null']) {
      const file = fileDellaRegola(ingresso);
      // Il file contiene il JSON di una stringa: si passa il testo crudo.
      writeFileSync(file, ingresso);
      const { uscita } = inPipe('(sleep 1; cat "$FILE")', { FILE: file });
      expect(uscita, `ingresso ${JSON.stringify(ingresso)}`).toBe(2);
    }
  });

  it('con il file come argomento, o con < file, dice lo stesso', () => {
    const file = fileDellaRegola(REGOLA_DI_OGGI);
    const conArgomento = spawnSync(process.execPath, ['scripts/controlla-regola-main.mjs', file], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 20_000,
      env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '' },
    });
    expect(conArgomento.status, conArgomento.stdout).toBe(1);
    const conRedirezione = spawnSync('bash', ['-c', '"$NODO" scripts/controlla-regola-main.mjs < "$FILE"'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 20_000,
      env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '', NODO: process.execPath, FILE: file },
    });
    expect(conRedirezione.status, conRedirezione.stdout).toBe(1);
  });

  it('un file che non c\'e\' e\' un «non lo so» (uscita 2), non una traccia nuda', () => {
    const esito = spawnSync(process.execPath, ['scripts/controlla-regola-main.mjs', '/non/esiste/regola.json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 20_000,
      env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '' },
    });
    expect(esito.status, `${esito.stdout}${esito.stderr}`).toBe(2);
    expect(esito.stdout).toContain('Non ho potuto leggere');
  });

  it('lanciato da un percorso che passa per un collegamento simbolico, parla lo stesso', () => {
    const file = fileDellaRegola(REGOLA_DI_OGGI);
    const cartella = mkdtempSync(join(tmpdir(), 'regola-main-'));
    cartelle.push(cartella);
    const collegamento = join(cartella, 'deposito');
    symlinkSync(process.cwd(), collegamento);
    const esito = spawnSync(process.execPath, [join(collegamento, 'scripts/controlla-regola-main.mjs'), file], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 20_000,
      env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '' },
    });
    expect(esito.status, `${esito.stdout}${esito.stderr}`).toBe(1);
    expect(esito.stdout).toContain('NON ferma le richieste con la CI rossa');
  });
});
