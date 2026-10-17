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
  uscitaDelVerdetto,
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
    expect(esito.diverse).toEqual([]);
    expect(esito.ramoAggiornato).toBe(false);
  });

  /*
   * 16/10/2026 (sesto giro) — Con la regola di oggi, spenta, lo script
   * stampava anche «nessuno puo' scavalcarla, nemmeno tu: con la CI rossa non
   * si unisce e non si spinge su main». Oggi con la CI rossa si unisce: la
   * regola e' spenta. Gli avvisi descrivono una regola che funziona, quindi
   * escono solo col ✅.
   */
  it('accanto a una regola spenta o diversa non scrive cosa farebbe la regola accesa', () => {
    const diversa = sistemata();
    diversa.conditions.ref_name.include = ['~ALL'] as never[];
    const senzaMain = sistemata();
    controlli(senzaMain).required_status_checks = [{ context: 'Unit tests' }];
    for (const regola of [REGOLA_DI_OGGI, diversa, senzaMain]) {
      const esito = valutaLaRegolaMain(regola);
      expect(esito.protegge).toBe(false);
      expect(esito.avvisi).toEqual([]);
    }
    // Con la regola dei passi, accesa e senza nessuno che la scavalca, invece si'.
    expect(valutaLaRegolaMain(sistemata()).avvisi.join('\n')).toContain('nessuno puo\' scavalcarla');
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
    // Di sicuro: ❌ con uscita 1, non un «guardala a mano».
    expect(uscitaDelVerdetto(valutaLaRegolaMain(escluso))).toBe(1);

    const altroRamo = sistemata();
    altroRamo.conditions.ref_name.include = ['refs/heads/sviluppo'] as never[];
    expect(valutaLaRegolaMain(altroRamo).protegge).toBe(false);
    expect(uscitaDelVerdetto(valutaLaRegolaMain(altroRamo))).toBe(1);

    // Il verde e' solo per «Include default branch», come nei passi: anche
    // main scritto per nome e' un'altra regola, da guardare a mano.
    expect(valutaLaRegolaMain(sistemata()).protegge).toBe(true);
    const perNome = sistemata();
    perNome.conditions.ref_name.include = ['refs/heads/main'] as never[];
    expect(valutaLaRegolaMain(perNome).protegge).toBe(false);
    expect(uscitaDelVerdetto(valutaLaRegolaMain(perNome))).toBe(3);
  });

  /*
   * 16/10/2026 — «INCLUDE ALL BRANCHES» NON E' UN VERDE. Nel menu di GitHub,
   * accanto a «Include default branch», c'e' «Include all branches». Lo
   * script contava '~ALL' come «guarda main» e diceva ✅ con uscita 0.
   *
   * Sesto giro: lo script non prova piu' a dire cosa succede sugli altri rami
   * (ogni frase su quello e' nata sbagliata in qualche caso). Una regola che
   * guarda altri rami e' diversa da quella dei passi: ⚪, uscita 3, e dice
   * come tornare ai passi.
   */
  it('«All branches» non protegge: e\' diversa dalla procedura, si guarda a mano e dice come tornare ai passi', () => {
    const r = sistemata();
    r.conditions.ref_name.include = ['~ALL'] as never[];
    const esito = valutaLaRegolaMain(r);
    expect(esito.protegge).toBe(false);
    expect(esito.mancano).toEqual([]);
    expect(uscitaDelVerdetto(esito)).toBe(3);
    expect(esito.diverse).toHaveLength(1);
    expect(esito.diverse[0].cosa).toContain('«Include all branches»');
    expect(esito.diverse[0].come).toContain('lascia solo «Include default branch»');
    const testo = righeDelVerdetto(esito).join('\n');
    expect(testo).not.toContain('✅');
    expect(righeDelVerdetto(esito)[0]).toContain('questa regola e\' diversa da quella della procedura: guardala a mano');
  });

  it('anche un modello che prende i rami di lavoro, accanto a main, non protegge', () => {
    const casi: string[][] = [
      ['refs/heads/**'],
      ['~DEFAULT_BRANCH', 'refs/heads/claude/**'],
      ['refs/heads/main', 'refs/heads/*'],
      ['~DEFAULT_BRANCH', 'refs/heads/sviluppo'],
      ['~DEFAULT_BRANCH', '~ALL'],
    ];
    for (const include of casi) {
      const r = sistemata();
      r.conditions.ref_name.include = include as never[];
      const esito = valutaLaRegolaMain(r);
      expect(esito.protegge, include.join(',')).toBe(false);
      expect(uscitaDelVerdetto(esito), include.join(',')).toBe(3);
      const voce = esito.diverse.find((m) => m.come.includes('lascia solo «Include default branch»'));
      expect(voce, include.join(',')).toBeDefined();
      for (const altro of include.filter((b) => b !== '~DEFAULT_BRANCH')) {
        expect(voce?.cosa, include.join(',')).toContain(altro === '~ALL' ? '«Include all branches»' : `«${altro}»`);
      }
    }
  });

  it('«All branches» con qualche ramo escluso: due differenze dalla procedura, i rami e le esclusioni', () => {
    const r = sistemata();
    r.conditions.ref_name.include = ['~ALL'] as never[];
    r.conditions.ref_name.exclude = ['refs/heads/claude/**'] as never[];
    const esito = valutaLaRegolaMain(r);
    expect(esito.protegge).toBe(false);
    expect(uscitaDelVerdetto(esito)).toBe(3);
    expect(esito.diverse.map((d) => d.cosa)).toEqual([
      expect.stringContaining('«Include all branches»'),
      expect.stringContaining('esclude dei rami («refs/heads/claude/**»)'),
    ]);
  });

  it('«All branches» con la regola spenta: ❌ con una cosa da sistemare, e la differenza dei rami da guardare a mano', () => {
    const r = sistemata();
    r.enforcement = 'disabled';
    r.conditions.ref_name.include = ['~ALL'] as never[];
    const esito = valutaLaRegolaMain(r);
    expect(esito.mancano).toHaveLength(1);
    expect(esito.diverse).toHaveLength(1);
    expect(uscitaDelVerdetto(esito)).toBe(1);
    const righe = righeDelVerdetto(esito);
    expect(righe[0]).toBe('❌ La regola «Main» non e\' quella della procedura. C\'e\' una cosa da sistemare:');
    expect(righe.join('\n')).toContain('In piu\', questa regola e\' diversa da quella della procedura: guardala a mano');
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
      // Le etichette non sono rami: «All branches» qui non c'e', e non si dice di toglierlo.
      expect(esito.mancano, target).toHaveLength(1);
      expect(esito.mancano.map((m) => m.come).join('\n'), target).not.toContain('All branches');
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

  it('una voce che i passi non chiedono, come la coda di unione, non e\' mai un verde: la nomina e la regola si guarda a mano', () => {
    for (const r of [sistemata(), sistemataConLaSpunta()]) {
      r.rules.push({ type: 'merge_queue' } as never);
      const esito = valutaLaRegolaMain(r);
      expect(esito.protegge).toBe(false);
      expect(uscitaDelVerdetto(esito)).toBe(3);
      expect(esito.diverse.map((d) => d.cosa).join('\n')).toContain('ha anche altre regole, che la procedura non chiede');
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
    expect(testo).toContain('non e\' quella della procedura. Ci sono 2 cose da sistemare');
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

  it('su una regola con «All branches», nella forma della prova del revisore, esce 3 e non dice ✅', () => {
    const file = fileDellaRegola({
      target: 'branch',
      enforcement: 'active',
      conditions: { ref_name: { include: ['~ALL'], exclude: [] } },
      rules: [
        {
          type: 'required_status_checks',
          parameters: { strict_required_status_checks_policy: false, required_status_checks: [{ context: 'Main' }] },
        },
      ],
      bypass_actors: [],
    });
    const { uscita, testo } = inPipe('(sleep 1; cat "$FILE")', { FILE: file });
    expect(uscita, testo).toBe(3);
    expect(testo).not.toContain('✅');
    expect(testo).toContain('questa regola e\' diversa da quella della procedura: guardala a mano');
    expect(testo).toContain('lascia solo «Include default branch»');
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
    expect(esito.stdout).toContain('non e\' quella della procedura');
  });
});
