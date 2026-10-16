/**
 * 16/10/2026 (correzione del lotto) — LO SCRIPT DELLA REGOLA «MAIN» LEGGE I
 * RAMI COME LI LEGGE GITHUB: COME MODELLI, NON COME NOMI.
 *
 * Tre difetti trovati dal riesame e verificati sul codice:
 *
 * ① Un'esclusione scritta a modello («refs/heads/*», «refs/heads/**»,
 *   «refs/heads/m*») lascia fuori main su GitHub, ma lo script confrontava le
 *   esclusioni per nome esatto: diceva ✅ e usciva 0. Era un verde falso sul
 *   passo che deve dire se il cancello delle richieste e' acceso.
 *
 * ② Con «refs/heads/**» fra i rami inclusi, la regola guarda main (e blocca
 *   anche gli altri rami), ma lo script scriveva «NON ferma le richieste con la
 *   CI rossa» e «non guarda il ramo main».
 *
 * ③ Con «All branches» piu' delle esclusioni, o con la spunta «Do not require
 *   status checks on creation», lo script diceva che nessuno spinge piu' su
 *   nessun ramo: sui rami esclusi, e nella creazione di rami nuovi, si spinge.
 *
 * E quando un modello GitHub lo potrebbe leggere in due modi (o lo script non
 * lo sa leggere), il verdetto e' «non so giudicare, controlla a mano», con
 * uscita 3: mai un verde, mai un ❌ inventato.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  valutaLaRegolaMain,
  righeDelVerdetto,
  uscitaDelVerdetto,
  modelloComprende,
} from '@/scripts/controlla-regola-main.mjs';

const MAIN = 'refs/heads/main';

/** Una regola accesa, che pretende «Main» da GitHub Actions: cambiano solo i rami e la spunta di creazione. */
function regola(include: unknown[], exclude: unknown[] = [], creazioneLibera = false, enforcement = 'active') {
  return {
    target: 'branch',
    enforcement,
    conditions: { ref_name: { include, exclude } },
    rules: [
      {
        type: 'required_status_checks',
        parameters: {
          strict_required_status_checks_policy: false,
          do_not_enforce_on_create: creazioneLibera,
          required_status_checks: [{ context: 'Main', integration_id: 15368 }],
        },
      },
    ],
    bypass_actors: [],
  };
}

function verdetto(r: unknown) {
  const esito = valutaLaRegolaMain(r);
  return { esito, testo: righeDelVerdetto(esito).join('\n'), titolo: righeDelVerdetto(esito)[0], uscita: uscitaDelVerdetto(esito) };
}

const cartelle: string[] = [];
afterAll(() => {
  for (const c of cartelle) rmSync(c, { recursive: true, force: true });
});

/** Lo script vero, col comando delle istruzioni e la risposta di `gh` in ritardo. */
function scriptInPipe(r: unknown) {
  const cartella = mkdtempSync(join(tmpdir(), 'regola-modelli-'));
  cartelle.push(cartella);
  const file = join(cartella, 'regola.json');
  writeFileSync(file, JSON.stringify(r));
  const esito = spawnSync('bash', ['-c', '(sleep 1; cat "$FILE") | "$NODO" scripts/controlla-regola-main.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 30_000,
    env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '', NODO: process.execPath, FILE: file },
  });
  return { uscita: esito.status ?? -1, testo: `${esito.stdout}\n${esito.stderr}` };
}

describe('un modello dei rami, letto come lo legge GitHub', () => {
  it('comprende main quando ogni lettura lo dice', () => {
    for (const m of ['refs/heads/*', 'refs/heads/**', 'refs/heads/m*', 'refs/heads/ma*', 'refs/heads/ma?n', 'refs/heads/main', '~ALL', '~DEFAULT_BRANCH']) {
      expect(modelloComprende(m, MAIN), m).toBe(true);
    }
  });

  it('non comprende main quando nessuna lettura lo dice', () => {
    for (const m of ['refs/heads/claude/**', 'refs/heads/n*', 'refs/heads/main2', 'refs/heads/*/main', 'refs/heads/main?']) {
      expect(modelloComprende(m, MAIN), m).toBe(false);
    }
  });

  it('dice «non lo so» quando le letture non vanno d\'accordo o il modello non lo sa leggere', () => {
    // «**/» vale zero cartelle per Ruby, almeno una per chi legge ** come «tutto»;
    // le maiuscole GitHub non dice se contano; [ ] e { } non li legge; senza refs/heads/ non sa.
    for (const m of ['refs/heads/**/main', 'refs/heads/MAIN', 'refs/heads/[m]ain', 'refs/heads/{main,dev}', 'main', 42, null]) {
      expect(modelloComprende(m, MAIN), String(m)).toBeNull();
    }
  });
});

describe('① un\'esclusione a modello che prende main non da\' mai il verde', () => {
  const esclusioniCheTolgonoMain = [['refs/heads/*'], ['refs/heads/**'], ['refs/heads/m*'], ['refs/heads/ma*'], ['~DEFAULT_BRANCH'], ['~ALL']];

  it('dice che non guarda main, perche\' l\'esclusione lo comprende, ed esce 1', () => {
    for (const exclude of esclusioniCheTolgonoMain) {
      const { esito, testo, titolo, uscita } = verdetto(regola(['~DEFAULT_BRANCH'], exclude));
      expect(esito.protegge, exclude.join(',')).toBe(false);
      expect(uscita, exclude.join(',')).toBe(1);
      expect(testo, exclude.join(',')).not.toContain('✅');
      expect(titolo, exclude.join(',')).toContain('NON ferma le richieste con la CI rossa');
      const voce = esito.mancano.find((m: { cosa: string }) => m.cosa.startsWith('non guarda il ramo main'));
      expect(voce?.cosa, exclude.join(',')).toContain('fra i rami esclusi');
      expect(voce?.come, exclude.join(',')).toContain('dai rami esclusi');
    }
  });

  it('un\'esclusione che non prende main lascia il verde', () => {
    for (const exclude of [['refs/heads/claude/**'], ['refs/heads/n*'], ['refs/heads/main-vecchio'], ['refs/heads/*/main']]) {
      const { esito, uscita } = verdetto(regola(['~DEFAULT_BRANCH'], exclude));
      expect(esito.protegge, exclude.join(',')).toBe(true);
      expect(uscita, exclude.join(',')).toBe(0);
    }
  });

  it('un modello in piu\' fra gli inclusi, cancellato da un\'esclusione identica, lascia il verde', () => {
    const { esito, uscita } = verdetto(regola(['~DEFAULT_BRANCH', 'refs/heads/claude/**'], ['refs/heads/claude/**']));
    expect(esito.protegge).toBe(true);
    expect(uscita).toBe(0);
  });

  it('lo script vero, con la regola del revisore (esclude refs/heads/**), esce 1 e non dice ✅', { timeout: 60_000 }, () => {
    const { uscita, testo } = scriptInPipe(regola(['~DEFAULT_BRANCH'], ['refs/heads/**']));
    expect(uscita, testo).toBe(1);
    expect(testo).not.toContain('✅');
    expect(testo).toContain('fra i rami esclusi c\'e\' «refs/heads/**», che comprende anche main');
  });
});

describe('② un modello fra gli inclusi che comprende main guarda main', () => {
  it('non scrive «non guarda il ramo main»: dice che ferma le richieste rosse ma blocca anche gli altri rami', () => {
    const titoloDiTutti = verdetto(regola(['~ALL'])).titolo;
    for (const include of [['refs/heads/**'], ['refs/heads/*'], ['refs/heads/m*']]) {
      const { esito, testo, titolo, uscita } = verdetto(regola(include));
      expect(esito.protegge, include.join(',')).toBe(false);
      expect(uscita, include.join(',')).toBe(1);
      expect(testo, include.join(',')).not.toContain('non guarda il ramo main');
      expect(testo, include.join(',')).not.toContain('NON ferma');
      expect(titolo, include.join(',')).toContain('ferma le richieste con la CI rossa, ma blocca anche le spinte sugli altri rami');
      // Due regole che coprono gli stessi rami ricevono lo stesso titolo.
      expect(titolo, include.join(',')).toBe(titoloDiTutti);
      expect(esito.mancano, include.join(',')).toHaveLength(1);
      expect(esito.mancano[0].come).toContain(`togli «${include[0]}»`);
    }
  });

  it('se non sa dire se guarda main, non dice che ferma le richieste rosse', () => {
    const { titolo, uscita } = verdetto(regola(['refs/heads/**/main']));
    expect(uscita).toBe(1);
    expect(titolo).not.toContain('ferma le richieste con la CI rossa, ma');
    expect(titolo).toContain('non so dire se ferma');
  });
});

describe('③ «All branches» con esclusioni o con la creazione libera non blocca ogni ramo', () => {
  const NESSUN_RAMO = 'su nessun ramo';

  it('con dei rami esclusi dice quali restano liberi, e non «su nessun ramo»', () => {
    const { esito, uscita } = verdetto(regola(['~ALL'], ['refs/heads/claude/**']));
    expect(esito.protegge).toBe(false);
    expect(uscita).toBe(1);
    const cosa = esito.mancano.map((m: { cosa: string }) => m.cosa).join('\n');
    expect(cosa).not.toContain(NESSUN_RAMO);
    expect(cosa).toContain('tranne quelli esclusi («refs/heads/claude/**»)');
    expect(cosa).toContain('Sui rami esclusi si spinge come prima');
    expect(esito.mancano[0].come).toContain('togli «All branches»');
  });

  it('con «Do not require status checks on creation» dice che i rami nuovi si creano ancora', () => {
    const { esito } = verdetto(regola(['~ALL'], [], true));
    const cosa = esito.mancano.map((m: { cosa: string }) => m.cosa).join('\n');
    expect(cosa).not.toContain(NESSUN_RAMO);
    expect(cosa).toContain('si possono ancora creare rami nuovi');
    expect(cosa).toContain('sui rami che esistono gia\'');
  });

  it('con tutte e due le cose le dice tutte e due', () => {
    const { esito } = verdetto(regola(['~ALL'], ['refs/heads/claude/**'], true));
    const cosa = esito.mancano.map((m: { cosa: string }) => m.cosa).join('\n');
    expect(cosa).not.toContain(NESSUN_RAMO);
    expect(cosa).toContain('Sui rami esclusi si spinge come prima');
    expect(cosa).toContain('si possono ancora creare rami nuovi');
  });

  it('senza esclusioni e senza la spunta, il blocco e\' davvero su ogni ramo', () => {
    const { esito } = verdetto(regola(['~ALL']));
    expect(esito.mancano[0].cosa).toContain(NESSUN_RAMO);
  });

  it('anche un modello accanto a main, con la creazione libera, dice che quei rami si creano ancora', () => {
    const { esito } = verdetto(regola(['~DEFAULT_BRANCH', 'refs/heads/claude/**'], [], true));
    const cosa = esito.mancano.map((m: { cosa: string }) => m.cosa).join('\n');
    expect(cosa).toContain('si possono ancora creare');
    expect(cosa).not.toContain('non riesce piu\' a spingere');
  });
});

describe('quando non sa giudicare un modello, lo dice e non da\' un verdetto', () => {
  const dubbie = [
    regola(['~DEFAULT_BRANCH'], ['refs/heads/[m]ain']),
    regola(['~DEFAULT_BRANCH'], ['refs/heads/**/main']),
    regola(['refs/heads/MAIN']),
    regola(['~DEFAULT_BRANCH', 'refs/heads/claude/*'], ['refs/heads/claude/**']),
  ];

  it('nessun ✅, nessun ❌: «controllala a mano», con uscita 3', () => {
    for (const r of dubbie) {
      const { esito, testo, titolo, uscita } = verdetto(r);
      const nome = JSON.stringify(r.conditions);
      expect(esito.protegge, nome).toBe(false);
      expect(esito.mancano, nome).toEqual([]);
      expect(esito.nonSoGiudicare.length, nome).toBeGreaterThan(0);
      expect(uscita, nome).toBe(3);
      expect(titolo, nome).toMatch(/^⚪ /);
      expect(titolo, nome).toContain('Controllala a mano');
      expect(testo, nome).not.toContain('✅');
      expect(testo, nome).not.toContain('❌');
    }
  });

  it('se c\'e\' anche un guaio sicuro, il ❌ resta e l\'uscita e\' 1', () => {
    const { titolo, uscita, esito } = verdetto(regola(['~DEFAULT_BRANCH'], ['refs/heads/[m]ain'], false, 'disabled'));
    expect(uscita).toBe(1);
    expect(titolo).toContain('NON ferma le richieste con la CI rossa. Le manca una cosa');
    expect(esito.nonSoGiudicare.length).toBeGreaterThan(0);
  });

  it('lo script vero esce 3 e non dice ✅', { timeout: 60_000 }, () => {
    const { uscita, testo } = scriptInPipe(regola(['~DEFAULT_BRANCH'], ['refs/heads/[m]ain']));
    expect(uscita, testo).toBe(3);
    expect(testo).not.toContain('✅');
    expect(testo).toContain('Da controllare a mano');
  });
});
