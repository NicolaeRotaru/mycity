/**
 * 15/10/2026 (collaudo di R57 e K45) — LA REGOLA «MAIN», ACCESA COME DICEVANO
 * LE ISTRUZIONI, NON AVREBBE FERMATO IL 1/9.
 *
 * Il primo giro di riparazione diceva a Nicola: accendi la regola «Main» su
 * GitHub, puntala su main, lascia «Require status checks to pass». Il collaudo
 * ha ricostruito l'incidente vero:
 *
 *   · la #245 aveva la CI verde alle 14:33 (corsa 33520192457, testa 2ab20bd);
 *   · alle 15:05 e' entrata in main la #246 (6843430);
 *   · alle 18:10 si e' unita la #245, ferma 31 commit indietro: l'unione
 *     2185736 e' finita ROSSA (corsa 33542096803, «Controlli database») ed e'
 *     andata in produzione.
 *
 * La regola vera (id 16879481) ha `strict_required_status_checks_policy:
 * false`: non pretende la richiesta aggiornata con main. Con i passi di prima,
 * il pulsante di unione della #245 sarebbe stato libero.
 *
 * Queste prove passano la regola — quella di oggi, letta da GitHub, e le sue
 * varianti — a scripts/controlla-regola-main.mjs, la funzione e lo script che
 * Nicola lancia dopo averla sistemata. Pretendono che dica ❌ finche' manca la
 * spunta del ramo aggiornato, anche con tutto il resto a posto, e ✅ solo
 * quando la regola ferma davvero quel giorno.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { valutaLaRegolaMain, righeDelVerdetto, CONTROLLO_RICHIESTO } from '@/scripts/controlla-regola-main.mjs';

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

/** La regola dopo i QUATTRO passi del primo giro: accesa, su main, «Main». Nient'altro. */
function coiPassiDelPrimoGiro(): Regola {
  const r = copia();
  r.enforcement = 'active';
  r.conditions.ref_name.include = ['~DEFAULT_BRANCH'] as never[];
  return r;
}

/** La regola dopo i passi di adesso: in piu' la spunta del ramo aggiornato. */
function coiPassiDiAdesso(): Regola {
  const r = coiPassiDelPrimoGiro();
  controlli(r).strict_required_status_checks_policy = true;
  return r;
}

const cartelle: string[] = [];
afterAll(() => {
  for (const c of cartelle) rmSync(c, { recursive: true, force: true });
});

/** Lo script vero, lanciato come lo lancia Nicola: la regola gli arriva da `gh api` sull'ingresso. */
function lancia(ingresso: string, script = 'scripts/controlla-regola-main.mjs') {
  const esito = spawnSync(process.execPath, [script], {
    cwd: process.cwd(),
    input: ingresso,
    encoding: 'utf8',
    timeout: 20_000,
    env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '' },
  });
  return { uscita: esito.status ?? -1, testo: `${esito.stdout}\n${esito.stderr}` };
}

describe('la regola «Main» ferma il codice rosso solo con il ramo aggiornato', () => {
  it('la regola di oggi non protegge niente: spenta, senza ramo, senza la spunta del ramo aggiornato', () => {
    const esito = valutaLaRegolaMain(REGOLA_DI_OGGI);
    expect(esito.letta).toBe(true);
    expect(esito.protegge).toBe(false);
    const cose = esito.mancano.map((m) => m.cosa).join('\n');
    expect(cose).toContain('spenta');
    expect(cose).toContain('non guarda nessun ramo');
    expect(cose).toContain('aggiornata con main');
    expect(esito.mancano).toHaveLength(3);
  });

  it('il 1/9 rifatto: accesa, su main, con «Main» ma senza la spunta, NON protegge', () => {
    const esito = valutaLaRegolaMain(coiPassiDelPrimoGiro());
    expect(esito.protegge).toBe(false);
    expect(esito.mancano).toHaveLength(1);
    expect(esito.mancano[0].cosa).toContain('#245');
    expect(esito.mancano[0].come).toContain('Require branches to be up to date before merging');
  });

  it('con la spunta del ramo aggiornato la regola protegge', () => {
    const esito = valutaLaRegolaMain(coiPassiDiAdesso());
    expect(esito.mancano).toEqual([]);
    expect(esito.protegge).toBe(true);
  });

  it('«Evaluate» non e\' acceso: registra ma non ferma', () => {
    const r = coiPassiDiAdesso();
    r.enforcement = 'evaluate';
    const esito = valutaLaRegolaMain(r);
    expect(esito.protegge).toBe(false);
    expect(esito.mancano[0].cosa).toContain('Evaluate');
  });

  it('main escluso, o un ramo che non e\' main, non protegge main', () => {
    const escluso = coiPassiDiAdesso();
    escluso.conditions.ref_name.exclude = ['refs/heads/main'] as never[];
    expect(valutaLaRegolaMain(escluso).protegge).toBe(false);

    const altroRamo = coiPassiDiAdesso();
    altroRamo.conditions.ref_name.include = ['refs/heads/sviluppo'] as never[];
    expect(valutaLaRegolaMain(altroRamo).protegge).toBe(false);

    for (const bersaglio of ['~DEFAULT_BRANCH', '~ALL', 'refs/heads/main']) {
      const r = coiPassiDiAdesso();
      r.conditions.ref_name.include = [bersaglio] as never[];
      expect(valutaLaRegolaMain(r).protegge, bersaglio).toBe(true);
    }
  });

  it('una regola che pretende un altro nome al posto di «Main» non protegge', () => {
    const r = coiPassiDiAdesso();
    controlli(r).required_status_checks = [{ context: 'Unit tests' }];
    const esito = valutaLaRegolaMain(r);
    expect(esito.protegge).toBe(false);
    expect(esito.mancano.map((m) => m.cosa).join('\n')).toContain(`«${CONTROLLO_RICHIESTO}»`);
  });

  it('senza la regola dei controlli, la spunta non c\'e\' e non si fa finta che ci sia', () => {
    const r = coiPassiDiAdesso();
    r.rules = r.rules.filter((x) => x.type !== 'required_status_checks');
    expect(valutaLaRegolaMain(r).protegge).toBe(false);
  });

  it('«Main» chiesto a un\'app che non e\' GitHub Actions non vale; da GitHub Actions si\'', () => {
    const altraApp = coiPassiDiAdesso();
    controlli(altraApp).required_status_checks = [{ context: 'Main', integration_id: 999 }];
    expect(valutaLaRegolaMain(altraApp).protegge).toBe(false);

    const actions = coiPassiDiAdesso();
    controlli(actions).required_status_checks = [{ context: 'Main', integration_id: 15368 }];
    expect(valutaLaRegolaMain(actions).protegge).toBe(true);
  });

  it('la coda di unione al posto della spunta non basta: ci.yml non gira su merge_group', () => {
    const r = coiPassiDelPrimoGiro();
    r.rules.push({ type: 'merge_queue' } as never);
    const esito = valutaLaRegolaMain(r);
    expect(esito.protegge).toBe(false);
    expect(esito.mancano[0].come).toContain('merge_group');
  });

  it('chi puo\' scavalcarla lo dice, senza nasconderlo e senza bocciare la regola', () => {
    const conPorta = coiPassiDiAdesso();
    conPorta.bypass_actors = [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }] as never[];
    const esito = valutaLaRegolaMain(conPorta);
    expect(esito.protegge).toBe(true);
    expect(esito.avvisi.join('\n')).toContain('scavalcarla');

    const senzaElenco = coiPassiDiAdesso() as Record<string, unknown>;
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
});

describe('lo script vero, lanciato come lo lancia Nicola', () => {
  it('sulla regola di oggi esce 1 ed elenca cosa manca, compresa la spunta del ramo aggiornato', () => {
    const { uscita, testo } = lancia(JSON.stringify(REGOLA_DI_OGGI));
    expect(uscita, testo).toBe(1);
    expect(testo).toContain('NON ferma il codice rosso');
    expect(testo).toContain('Require branches to be up to date before merging');
  });

  it('sulla regola sistemata esce 0', () => {
    const { uscita, testo } = lancia(JSON.stringify(coiPassiDiAdesso()));
    expect(uscita, testo).toBe(0);
    expect(testo).toContain('✅');
  });

  it('su una risposta vuota, illeggibile o di errore esce 2: un «non lo so», non un verde', () => {
    for (const ingresso of ['', 'non e\' JSON', '{"message":"Not Found"}', 'null']) {
      const { uscita } = lancia(ingresso);
      expect(uscita, `ingresso ${JSON.stringify(ingresso)}`).toBe(2);
    }
  });

  it('lanciato da un percorso che passa per un collegamento simbolico, parla lo stesso', () => {
    const cartella = mkdtempSync(join(tmpdir(), 'regola-main-'));
    cartelle.push(cartella);
    const collegamento = join(cartella, 'deposito');
    symlinkSync(process.cwd(), collegamento);
    const file = join(cartella, 'regola.json');
    writeFileSync(file, JSON.stringify(REGOLA_DI_OGGI));
    const esito = spawnSync(process.execPath, [join(collegamento, 'scripts/controlla-regola-main.mjs'), file], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 20_000,
      env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '' },
    });
    expect(esito.status, `${esito.stdout}${esito.stderr}`).toBe(1);
    expect(esito.stdout).toContain('NON ferma il codice rosso');
  });
});
