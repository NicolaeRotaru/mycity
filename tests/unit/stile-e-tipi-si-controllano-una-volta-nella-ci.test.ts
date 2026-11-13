/**
 * 13/11/2026 — STILE E TIPI SI CONTROLLANO UNA VOLTA NELLA CI, MA SEMPRE.
 *
 * Nicola, «ok 1 e 2»: nella CI il sito si costruiva 9 volte (8 fette delle
 * prove nel browser + axe) e ogni costruzione rifaceva il controllo di stile e
 * di tipi, circa 47 secondi su 95. Quelle 9 costruzioni ora lo saltano, con la
 * variabile MYCITY_COSTRUZIONE_PER_LE_PROVE letta da next.config.js.
 *
 * Saltarlo e' giusto solo se tre cose restano vere, e queste prove le tengono:
 *  ① il controllo vero resta: il lavoro «Lint + Typecheck + Build» fa lint e
 *    build senza la variabile, e Main lo aspetta;
 *  ② la variabile vive solo nei due lavori delle prove (e2e-senza-chiavi, a11y)
 *    e in nessun altro posto del repository che possa costruire il sito;
 *  ③ next.config.js la ascolta solo dentro GitHub Actions, nei due lavori delle
 *    prove e fuori da `vercel build`: il rilascio in produzione gira anche lui
 *    in GitHub Actions (deploy-dopo-ci.yml) e li' controlla tipi e stile lo
 *    stesso, anche se qualcuno mettesse la variabile fra quelle di Vercel.
 * La prima prova di ogni gruppo gira su una forma sbagliata e pretende che il
 * controllo la bocci.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const VARIABILE = 'MYCITY_COSTRUZIONE_PER_LE_PROVE';
const LAVORI_AMMESSI = ['e2e-senza-chiavi', 'a11y'];
const LAVORO_DEI_CONTROLLI = 'lint-and-typecheck';

/** I lavori della CI letti dall'indentazione, come fa GitHub: id → testo. */
function leggiLavori(workflow: string): Map<string, string> {
  const righe = workflow.split('\n');
  const inizio = righe.findIndex((r) => /^jobs:\s*$/.test(r));
  const lavori = new Map<string, string>();
  let id: string | null = null;
  let corpo: string[] = [];
  for (let i = inizio + 1; i < righe.length; i++) {
    const capo = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(righe[i]);
    if (capo) {
      if (id) lavori.set(id, corpo.join('\n'));
      id = capo[1];
      corpo = [];
      continue;
    }
    if (id) corpo.push(righe[i]);
  }
  if (id) lavori.set(id, corpo.join('\n'));
  return lavori;
}

/** Vuoto = la CI controlla stile e tipi una volta, obbligatoriamente. */
function perche_stile_e_tipi_possono_sfuggire(workflow: string): string[] {
  const motivi: string[] = [];
  const inizioLavori = workflow.search(/^jobs:\s*$/m);
  if (workflow.slice(0, inizioLavori).includes(VARIABILE)) {
    motivi.push(`${VARIABILE} e' impostata per tutta la CI, non solo per i lavori delle prove`);
  }
  const lavori = leggiLavori(workflow);
  for (const [id, testo] of lavori) {
    if (testo.includes(VARIABILE) && !LAVORI_AMMESSI.includes(id)) {
      motivi.push(`${VARIABILE} compare nel lavoro «${id}»: li' stile e tipi non si controllerebbero`);
    }
  }
  const controlli = lavori.get(LAVORO_DEI_CONTROLLI);
  if (!controlli) {
    motivi.push(`il lavoro «${LAVORO_DEI_CONTROLLI}» non c'e' piu'`);
  } else {
    // I comandi si leggono come righe `run:` intere di un passo, non come parole
    // nel testo: un `|| true`, un `echo "run: npm run lint"` o un commento non
    // contano come controllo.
    const comandi = [...controlli.matchAll(/^ {8}run:[ \t]*(.*?)[ \t]*$/gm)].map((m) => m[1]);
    if (!comandi.includes('npm run lint --if-present') && !comandi.includes('npm run lint')) {
      motivi.push(`«${LAVORO_DEI_CONTROLLI}» non lancia piu' npm run lint, da solo e senza vie d'uscita`);
    }
    if (!comandi.includes('npm run build')) {
      motivi.push(`«${LAVORO_DEI_CONTROLLI}» non lancia piu' npm run build, da solo e senza vie d'uscita: e' il controllo dei tipi`);
    }
    if (/set \+e|\|\|\s*(true|:|exit 0)/.test(controlli)) {
      motivi.push(`«${LAVORO_DEI_CONTROLLI}» ha un'uscita forzata a verde (set +e o || true)`);
    }
    if (/^ {4,8}if:/m.test(controlli)) motivi.push(`«${LAVORO_DEI_CONTROLLI}» ha una condizione: potrebbe non girare`);
    if (/continue-on-error:\s*true/.test(controlli)) motivi.push(`«${LAVORO_DEI_CONTROLLI}» non ferma niente se e' rosso`);
  }
  const main = lavori.get('cancello-main') ?? '';
  const attesi = /needs:\s*\n((?:\s+- .+\n?)+)/.exec(main)?.[1] ?? '';
  if (!new RegExp(`-\\s*${LAVORO_DEI_CONTROLLI}\\b`).test(attesi)) {
    motivi.push(`Main non aspetta piu' «${LAVORO_DEI_CONTROLLI}»`);
  }
  return motivi;
}

/** Cosa dice next.config.js con queste sole variabili d'ambiente, in un processo pulito. */
function configCon(variabili: Record<string, string>) {
  const ambiente: Record<string, string> = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' };
  const uscita = execFileSync(
    process.execPath,
    ['-e', "const c=require('./next.config.js');process.stdout.write(JSON.stringify({t:c.typescript,e:c.eslint}))"],
    { env: { ...ambiente, ...variabili }, encoding: 'utf8' },
  );
  const { t, e } = JSON.parse(uscita);
  return { saltaTipi: t?.ignoreBuildErrors === true, saltaStile: e?.ignoreDuringBuilds === true };
}

/** Tutti i file del repository che possono costruire o configurare il sito. */
function fileDaSorvegliare(cartella = '.'): string[] {
  const fuori = new Set(['node_modules', '.git', '.next', 'coverage', 'playwright-report', 'test-results']);
  const trovati: string[] = [];
  for (const nome of readdirSync(cartella)) {
    if (fuori.has(nome)) continue;
    const percorso = join(cartella, nome);
    if (statSync(percorso).isDirectory()) trovati.push(...fileDaSorvegliare(percorso));
    else if (/\.(ya?ml|json|js|mjs|cjs|ts|sh|toml)$|^\.env/.test(nome)) trovati.push(percorso);
  }
  return trovati;
}

const workflowVero = readFileSync('.github/workflows/ci.yml', 'utf8');

describe('① e ② il controllo di stile e tipi resta, una volta, nel lavoro che Main aspetta', () => {
  it('boccia la variabile messa nel lavoro dei controlli (la forma sbagliata)', () => {
    const rotto = workflowVero.replace(
      /(\n  lint-and-typecheck:\n[\s\S]*?- name: Build\n        env:\n)/,
      `$1          ${VARIABILE}: "1"\n`,
    );
    expect(rotto, 'la manomissione di prova non ha trovato il passo Build').not.toBe(workflowVero);
    expect(perche_stile_e_tipi_possono_sfuggire(rotto).join('\n')).toContain('lint-and-typecheck');
  });

  it('boccia la variabile messa per tutta la CI', () => {
    const rotto = workflowVero.replace(/^jobs:\s*$/m, `env:\n  ${VARIABILE}: "1"\n\njobs:`);
    expect(perche_stile_e_tipi_possono_sfuggire(rotto).join('\n')).toContain('per tutta la CI');
  });

  it('boccia un controllo che non ferma piu niente (|| true)', () => {
    const rotto = workflowVero.replace(/(\n  lint-and-typecheck:[\s\S]*?)run: npm run build/, '$1run: npm run build || true');
    expect(rotto).not.toBe(workflowVero);
    expect(perche_stile_e_tipi_possono_sfuggire(rotto).join('\n')).toContain('npm run build');
  });

  it('boccia un comando che nomina il lint senza lanciarlo', () => {
    const rotto = workflowVero.replace(/(\n  lint-and-typecheck:[\s\S]*?)run: npm run lint --if-present/, '$1run: echo "run: npm run lint"');
    expect(rotto).not.toBe(workflowVero);
    expect(perche_stile_e_tipi_possono_sfuggire(rotto).join('\n')).toContain('npm run lint');
  });

  it('boccia un lavoro dei controlli che non costruisce piu', () => {
    const rotto = workflowVero.replace(/(\n  lint-and-typecheck:[\s\S]*?)run: npm run build/, '$1run: echo saltato');
    expect(perche_stile_e_tipi_possono_sfuggire(rotto).join('\n')).toContain('npm run build');
  });

  it('la CI vera: nessun motivo', () => {
    expect(perche_stile_e_tipi_possono_sfuggire(workflowVero)).toEqual([]);
  });

  it('la variabile c e davvero nei due lavori delle prove, altrimenti il risparmio non esiste', () => {
    const lavori = leggiLavori(workflowVero);
    for (const id of LAVORI_AMMESSI) expect(lavori.get(id) ?? '', id).toContain(`${VARIABILE}: "1"`);
  });

  it('nessun altro file del repository imposta la variabile', () => {
    const ammessi = new Set([
      join('.github', 'workflows', 'ci.yml'),
      'next.config.js',
      join('tests', 'unit', 'stile-e-tipi-si-controllano-una-volta-nella-ci.test.ts'),
    ]);
    const intrusi = fileDaSorvegliare().filter(
      (f) => !ammessi.has(f) && readFileSync(f, 'utf8').includes(VARIABILE),
    );
    expect(intrusi).toEqual([]);
  });
});

describe('③ next.config.js ascolta la variabile solo dentro GitHub Actions', () => {
  it('senza niente controlla tutto', () => {
    expect(configCon({})).toEqual({ saltaTipi: false, saltaStile: false });
  });

  it('con la sola variabile (per esempio impostata per sbaglio su Vercel) controlla tutto', () => {
    expect(configCon({ [VARIABILE]: '1', VERCEL: '1' })).toEqual({ saltaTipi: false, saltaStile: false });
  });

  it('dentro GitHub Actions ma senza la variabile (il lavoro dei controlli) controlla tutto', () => {
    expect(configCon({ GITHUB_ACTIONS: 'true', CI: 'true' })).toEqual({ saltaTipi: false, saltaStile: false });
  });

  it('un valore diverso da "1" non basta', () => {
    expect(configCon({ GITHUB_ACTIONS: 'true', GITHUB_JOB: 'a11y', [VARIABILE]: 'true' })).toEqual({ saltaTipi: false, saltaStile: false });
  });

  it('il rilascio in produzione (vercel build dentro GitHub Actions) controlla tutto anche con la variabile', () => {
    expect(configCon({ GITHUB_ACTIONS: 'true', GITHUB_JOB: 'a11y', VERCEL: '1', [VARIABILE]: '1' })).toEqual({
      saltaTipi: false,
      saltaStile: false,
    });
  });

  it('un altro lavoro di GitHub Actions (il rilascio, il lavoro lint) controlla tutto anche con la variabile', () => {
    for (const lavoro of ['deploy', 'lint-and-typecheck', 'e2e-tests', '']) {
      expect(configCon({ GITHUB_ACTIONS: 'true', GITHUB_JOB: lavoro, [VARIABILE]: '1' }), lavoro).toEqual({
        saltaTipi: false,
        saltaStile: false,
      });
    }
  });

  it('solo i due lavori delle prove, dentro GitHub Actions, saltano il doppione', () => {
    for (const lavoro of ['e2e-senza-chiavi', 'a11y']) {
      expect(configCon({ GITHUB_ACTIONS: 'true', GITHUB_JOB: lavoro, [VARIABILE]: '1' }), lavoro).toEqual({
        saltaTipi: true,
        saltaStile: true,
      });
    }
  });
});
