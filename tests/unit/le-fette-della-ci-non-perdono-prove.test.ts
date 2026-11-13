/**
 * 13/11/2026 — Le prove della CI girano divise in fette. Una fetta da sola puo'
 * uscire verde anche se un pezzo di prove non ha girato da nessuna parte: con
 * un lavoro unico non poteva succedere. scripts/ricuci-fette-ci.mjs rimette
 * insieme i referti e deve fermarsi ROSSO in ognuno dei modi in cui le fette
 * possono perdere una prova. Qui quei modi si costruiscono apposta, uno per uno,
 * con referti finti ma della stessa forma di quelli veri (vitest list --json,
 * il reporter json di vitest, playwright test --list e il suo reporter json).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { principale, ricuciVitest, ricuciPlaywright, leggiFette } from '@/scripts/ricuci-fette-ci.mjs';

const RADICE = '/home/runner/work/mycity/mycity';
const COMMIT = 'abc123';

type Fetta = { indice: number; totale: number; commit?: string; radice?: string };

const cartelle: string[] = [];
function nuovaCartella(): string {
  const c = mkdtempSync(join(tmpdir(), 'fette-ci-'));
  cartelle.push(c);
  return c;
}
afterEach(() => {
  while (cartelle.length > 0) rmSync(cartelle.pop()!, { recursive: true, force: true });
});

function scriviFetta(cartella: string, nome: string, fetta: Fetta, universo: unknown, esito: unknown) {
  const dir = join(cartella, nome);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'fetta.json'), JSON.stringify({ commit: COMMIT, radice: RADICE, ...fetta }));
  writeFileSync(join(dir, 'universo.json'), JSON.stringify(universo));
  writeFileSync(join(dir, 'esito.json'), typeof esito === 'string' ? esito : JSON.stringify(esito));
}

// ---------------------------------------------------------------- vitest

const FILE = ['tests/unit/a.test.ts', 'tests/unit/b.test.ts', 'tests/unit/c.test.ts', 'tests/unit/d.test.tsx'];
const universoVitest = (file = FILE) => file.map((f) => ({ file: `${RADICE}/${f}` }));
function esitoVitest(file: string[], stato: 'passed' | 'failed' = 'passed') {
  return {
    success: stato === 'passed',
    numFailedTests: stato === 'failed' ? 1 : 0,
    testResults: file.map((f) => ({
      name: `${RADICE}/${f}`,
      status: stato,
      assertionResults: [{ status: stato }, { status: 'passed' }],
    })),
  };
}

/** Tre fette che si dividono i quattro file come farebbe vitest --shard. */
function treFetteVitestSane(cartella: string) {
  scriviFetta(cartella, 'referto-unitari-0', { indice: 0, totale: 3 }, universoVitest(), esitoVitest(FILE.slice(0, 2)));
  scriviFetta(cartella, 'referto-unitari-1', { indice: 1, totale: 3 }, universoVitest(), esitoVitest(FILE.slice(2, 3)));
  scriviFetta(cartella, 'referto-unitari-2', { indice: 2, totale: 3 }, universoVitest(), esitoVitest(FILE.slice(3)));
}

function ricuciCartellaVitest(cartella: string) {
  const letto = leggiFette(cartella);
  expect(letto.problemi).toEqual([]);
  return ricuciVitest(letto.fette);
}

describe('le fette delle prove unitarie si rimettono insieme', () => {
  it('tre fette che coprono ogni file una volta sola: verde', () => {
    const c = nuovaCartella();
    treFetteVitestSane(c);
    const esito = ricuciCartellaVitest(c);
    expect(esito.problemi).toEqual([]);
    expect(esito.righe.join('\n')).toContain('4 file** su 4');
  });

  it('una fetta che non ha consegnato il referto: rosso, e dice quale', () => {
    const c = nuovaCartella();
    treFetteVitestSane(c);
    rmSync(join(c, 'referto-unitari-1'), { recursive: true });
    const esito = ricuciCartellaVitest(c);
    expect(esito.problemi.join('\n')).toMatch(/manca il referto della fetta 2 di 3/);
  });

  it('una fetta che prende la parte sbagliata (un file in due fette, uno in nessuna): rosso', () => {
    const c = nuovaCartella();
    scriviFetta(c, 'referto-unitari-0', { indice: 0, totale: 2 }, universoVitest(), esitoVitest(FILE.slice(0, 2)));
    // La seconda fetta rifà il primo file e si dimentica l'ultimo.
    scriviFetta(c, 'referto-unitari-1', { indice: 1, totale: 2 }, universoVitest(), esitoVitest([FILE[0], FILE[2]]));
    const problemi = ricuciCartellaVitest(c).problemi.join('\n');
    expect(problemi).toMatch(/tests\/unit\/a\.test\.ts» ha girato due volte/);
    expect(problemi).toMatch(/1 prove dell'elenco non hanno girato in nessuna fetta.*d\.test\.tsx/);
  });

  it('due fette che dicono di essere la stessa: rosso', () => {
    const c = nuovaCartella();
    scriviFetta(c, 'referto-unitari-0', { indice: 0, totale: 2 }, universoVitest(), esitoVitest(FILE.slice(0, 2)));
    scriviFetta(c, 'referto-unitari-1', { indice: 0, totale: 2 }, universoVitest(), esitoVitest(FILE.slice(2)));
    const problemi = ricuciCartellaVitest(c).problemi.join('\n');
    expect(problemi).toMatch(/due referti dicono di essere la fetta 1/);
    expect(problemi).toMatch(/manca il referto della fetta 2 di 2/);
  });

  it('fette che non sono d\'accordo su quante sono: rosso', () => {
    const c = nuovaCartella();
    scriviFetta(c, 'referto-unitari-0', { indice: 0, totale: 2 }, universoVitest(), esitoVitest(FILE.slice(0, 2)));
    scriviFetta(c, 'referto-unitari-1', { indice: 1, totale: 3 }, universoVitest(), esitoVitest(FILE.slice(2)));
    expect(ricuciCartellaVitest(c).problemi.join('\n')).toMatch(/non sono d'accordo su quante sono/);
  });

  it('fette girate su commit diversi: rosso', () => {
    const c = nuovaCartella();
    scriviFetta(c, 'referto-unitari-0', { indice: 0, totale: 2 }, universoVitest(), esitoVitest(FILE.slice(0, 2)));
    scriviFetta(c, 'referto-unitari-1', { indice: 1, totale: 2, commit: 'altro' }, universoVitest(), esitoVitest(FILE.slice(2)));
    expect(ricuciCartellaVitest(c).problemi.join('\n')).toMatch(/commit diversi/);
  });

  it('fette che non vedevano lo stesso elenco di file: rosso', () => {
    const c = nuovaCartella();
    scriviFetta(c, 'referto-unitari-0', { indice: 0, totale: 2 }, universoVitest(), esitoVitest(FILE.slice(0, 2)));
    scriviFetta(c, 'referto-unitari-1', { indice: 1, totale: 2 }, universoVitest(FILE.slice(0, 3)), esitoVitest(FILE.slice(2)));
    expect(ricuciCartellaVitest(c).problemi.join('\n')).toMatch(/non vedevano le stesse prove/);
  });

  it('l\'esito di un file che nell\'elenco non c\'e\': rosso', () => {
    const c = nuovaCartella();
    scriviFetta(c, 'referto-unitari-0', { indice: 0, totale: 1 }, universoVitest(), esitoVitest([...FILE, 'tests/unit/z.test.ts']));
    expect(ricuciCartellaVitest(c).problemi.join('\n')).toMatch(/1 esiti di prove che nell'elenco non ci sono/);
  });

  it('un file rosso in una fetta: rosso anche qui', () => {
    const c = nuovaCartella();
    scriviFetta(c, 'referto-unitari-0', { indice: 0, totale: 2 }, universoVitest(), esitoVitest(FILE.slice(0, 2)));
    scriviFetta(c, 'referto-unitari-1', { indice: 1, totale: 2 }, universoVitest(), esitoVitest(FILE.slice(2), 'failed'));
    const problemi = ricuciCartellaVitest(c).problemi.join('\n');
    expect(problemi).toMatch(/non e' verde \(failed\)/);
    expect(problemi).toMatch(/prove rosse/);
  });

  it('un elenco vuoto non e\' un verde: non c\'era niente da far girare', () => {
    const c = nuovaCartella();
    scriviFetta(c, 'referto-unitari-0', { indice: 0, totale: 1 }, [], esitoVitest([]));
    expect(ricuciCartellaVitest(c).problemi.join('\n')).toMatch(/elenco delle prove e' vuoto/);
  });

  it('un referto che non si legge, o una cartella vuota, non sono un verde', () => {
    const c = nuovaCartella();
    scriviFetta(c, 'referto-unitari-0', { indice: 0, totale: 1 }, universoVitest(), '{ rotto');
    expect(leggiFette(c).problemi.join('\n')).toMatch(/esito\.json non si legge/);
    expect(leggiFette(nuovaCartella()).problemi.join('\n')).toMatch(/nessun referto di fetta/);
    expect(leggiFette(join(nuovaCartella(), 'non-esiste')).problemi.join('\n')).toMatch(/non esiste/);
  });
});

// ---------------------------------------------------------------- playwright

type ProvaPw = { titolo: string; linea: number; stato?: string; motivo?: string };
const PROVE_PW: ProvaPw[] = [
  { titolo: 'la home si apre', linea: 5 },
  { titolo: 'la ricerca risponde', linea: 9 },
  { titolo: 'la cassa disegna il modulo', linea: 14 },
  { titolo: 'la cassa vera', linea: 20 },
];

function suitePw(prove: ProvaPw[], conEsito: boolean) {
  return {
    suites: [
      {
        title: 'negozio.spec.ts',
        file: 'negozio.spec.ts',
        specs: prove.map((p) => ({
          title: p.titolo,
          file: 'negozio.spec.ts',
          line: p.linea,
          column: 3,
          tests: [
            {
              projectName: 'chromium',
              ...(conEsito
                ? {
                    status: p.stato ?? 'expected',
                    annotations: p.motivo ? [{ type: 'skip', description: p.motivo }] : [],
                    results: [{ status: p.stato === 'skipped' ? 'skipped' : 'passed' }],
                  }
                : {}),
            },
          ],
        })),
      },
    ],
  };
}

function ricuciCartellaPw(cartella: string) {
  const letto = leggiFette(cartella);
  expect(letto.problemi).toEqual([]);
  return ricuciPlaywright(letto.fette);
}

function dueFettePw(cartella: string, prima: ProvaPw[], seconda: ProvaPw[], universo = PROVE_PW) {
  scriviFetta(cartella, 'referto-browser-0', { indice: 0, totale: 2 }, suitePw(universo, false), suitePw(prima, true));
  scriviFetta(cartella, 'referto-browser-1', { indice: 1, totale: 2 }, suitePw(universo, false), suitePw(seconda, true));
}

describe('le fette delle prove nel browser si rimettono insieme', () => {
  it('due fette che coprono ogni prova una volta sola, con le saltate motivate: verde', () => {
    const c = nuovaCartella();
    const [a, b, cc, d] = PROVE_PW;
    dueFettePw(c, [a, b], [cc, { ...d, stato: 'skipped', motivo: 'serve E2E_DATI_DI_PROVA' }]);
    const esito = ricuciCartellaPw(c);
    expect(esito.problemi).toEqual([]);
    const testo = esito.righe.join('\n');
    expect(testo).toContain('4 prove** su 4');
    expect(testo).toContain('serve E2E_DATI_DI_PROVA');
  });

  it('una prova dell\'elenco che non ha girato in nessuna fetta: rosso, e la nomina', () => {
    const c = nuovaCartella();
    const [a, b, cc] = PROVE_PW;
    dueFettePw(c, [a, b], [cc]);
    expect(ricuciCartellaPw(c).problemi.join('\n')).toMatch(/1 prove dell'elenco non hanno girato.*la cassa vera/);
  });

  it('una prova che ha girato in due fette: rosso', () => {
    const c = nuovaCartella();
    const [a, b, cc, d] = PROVE_PW;
    dueFettePw(c, [a, b, cc], [cc, d]);
    expect(ricuciCartellaPw(c).problemi.join('\n')).toMatch(/la cassa disegna il modulo \[chromium\]» ha girato due volte/);
  });

  it('una prova saltata senza motivo: rosso, come nella fetta', () => {
    const c = nuovaCartella();
    const [a, b, cc, d] = PROVE_PW;
    dueFettePw(c, [a, b], [cc, { ...d, stato: 'skipped' }]);
    expect(ricuciCartellaPw(c).problemi.join('\n')).toMatch(/la cassa vera» e' saltata senza dire perche'/);
  });

  it('tutte saltate, anche se motivate: rosso, nessuna pagina e\' stata aperta', () => {
    const c = nuovaCartella();
    const salta = (p: ProvaPw) => ({ ...p, stato: 'skipped', motivo: 'spenta' });
    dueFettePw(c, PROVE_PW.slice(0, 2).map(salta), PROVE_PW.slice(2).map(salta));
    expect(ricuciCartellaPw(c).problemi.join('\n')).toMatch(/si sono saltate tutte/);
  });

  it('una prova rossa: rosso', () => {
    const c = nuovaCartella();
    const [a, b, cc, d] = PROVE_PW;
    dueFettePw(c, [a, { ...b, stato: 'unexpected' }], [cc, d]);
    expect(ricuciCartellaPw(c).problemi.join('\n')).toMatch(/1 prove nel browser rosse: negozio\.spec\.ts › la ricerca risponde/);
  });
});

// ---------------------------------------------------------------- da riga di comando

describe('lo script da riga di comando', () => {
  const SCRIPT = join(process.cwd(), 'scripts/ricuci-fette-ci.mjs');

  it('esce 0 sulle fette sane e scrive il riassunto dove lo legge GitHub', () => {
    const c = nuovaCartella();
    treFetteVitestSane(c);
    const riassunto = join(nuovaCartella(), 'riassunto.md');
    const r = spawnSync(process.execPath, [SCRIPT, 'vitest', c], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_STEP_SUMMARY: riassunto },
    });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(readFileSync(riassunto, 'utf8')).toContain('Prove unitarie, tutte le fette insieme');
  });

  it('esce 1 con un ::error:: quando manca una fetta', () => {
    const c = nuovaCartella();
    treFetteVitestSane(c);
    rmSync(join(c, 'referto-unitari-2'), { recursive: true });
    const r = spawnSync(process.execPath, [SCRIPT, 'vitest', c], { encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '' } });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/^::error::manca il referto della fetta 3 di 3/m);
  });

  it('senza argomenti, o con un tipo che non conosce, non da\' il via libera', () => {
    expect(principale([], {})).toBe(1);
    expect(principale(['jest', nuovaCartella()], {})).toBe(1);
    expect(principale(['vitest', join(nuovaCartella(), 'vuota')], {})).toBe(1);
  });
});

// ---------------------------------------------------------------- i fili nella CI

const richiedi = createRequire(import.meta.url);
const yaml = richiedi('js-yaml') as { load: (testo: string) => unknown };
type Passo = { name?: string; uses?: string; run?: string; env?: Record<string, string>; with?: Record<string, string> };
type Lavoro = { name?: string; needs?: string | string[]; if?: string; strategy?: { matrix?: Record<string, unknown> }; steps?: Passo[] };
const CI = yaml.load(readFileSync(join(process.cwd(), '.github/workflows/ci.yml'), 'utf8')) as { jobs: Record<string, Lavoro> };

function passoCon(lavoro: Lavoro, pezzo: RegExp): Passo | undefined {
  return (lavoro.steps ?? []).find((p) => pezzo.test(p.run ?? ''));
}

describe('nella CI le fette sono collegate a chi le rimette insieme', () => {
  for (const [fette, insieme, artefatto, tipo, comando] of [
    ['unit-tests', 'unit-tests-insieme', 'referto-unitari', 'vitest', /npm run test\b/],
    ['e2e-senza-chiavi', 'e2e-senza-chiavi-insieme', 'referto-browser', 'playwright', /npm run test:e2e/],
  ] as const) {
    it(`${fette}: quale fetta e quante lo dice GitHub, non un numero scritto a mano`, () => {
      const lavoro = CI.jobs[fette];
      expect(lavoro.strategy?.matrix, `${fette} non e' piu' diviso in fette`).toBeDefined();
      const passo = passoCon(lavoro, comando)!;
      expect(passo, `${fette}: non trovo il passo che fa girare le prove`).toBeDefined();
      expect(passo.env?.FETTA_INDICE).toBe('${{ strategy.job-index }}');
      expect(passo.env?.FETTE_TOTALI).toBe('${{ strategy.job-total }}');
      expect(passo.run).toContain('--shard="$((FETTA_INDICE + 1))/$FETTE_TOTALI"');
    });

    it(`${fette}: ogni fetta consegna il suo referto, e ${insieme} li prende tutti`, () => {
      const consegna = (CI.jobs[fette].steps ?? []).find((p) => p.uses?.startsWith('actions/upload-artifact@'));
      expect(consegna?.with?.name).toBe(`${artefatto}-\${{ strategy.job-index }}`);
      expect(consegna?.with?.['if-no-files-found']).toBe('error');
      const lavoro = CI.jobs[insieme];
      expect(lavoro, `manca il lavoro ${insieme}`).toBeDefined();
      expect(lavoro.needs).toBe(fette);
      expect(lavoro.if, `${insieme} non deve avere condizioni`).toBeUndefined();
      const presa = (lavoro.steps ?? []).find((p) => p.uses?.startsWith('actions/download-artifact@'));
      expect(presa?.with?.pattern).toBe(`${artefatto}-*`);
      expect(passoCon(lavoro, /scripts\/ricuci-fette-ci\.mjs/)?.run).toContain(`ricuci-fette-ci.mjs ${tipo} `);
    });
  }

  it('il cancello «Main» aspetta anche chi rimette insieme le fette', () => {
    const needs = CI.jobs['cancello-main'].needs as string[];
    expect(needs).toEqual(expect.arrayContaining(['unit-tests', 'unit-tests-insieme', 'e2e-senza-chiavi', 'e2e-senza-chiavi-insieme']));
  });
});
