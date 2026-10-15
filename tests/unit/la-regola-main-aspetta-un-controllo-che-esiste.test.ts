/**
 * 15/10/2026 (R57) — LA REGOLA CHE DOVEVA FERMARE IL CODICE ROSSO ASPETTAVA UN
 * CONTROLLO CHE NESSUNO PRODUCEVA.
 *
 * Su GitHub c'e' una regola chiamata «Main» (ruleset 16879481, creata il 26/5)
 * che pretende un controllo verde di nome «Main» prima di poter unire. Nessun
 * lavoro della CI si chiamava cosi'. Accesa sul ramo main, la regola avrebbe
 * bloccato ogni unione per sempre; spenta, non fermava niente: nessuna
 * richiesta con la CI rossa trovava il pulsante di unione chiuso.
 *
 * Adesso la CI ha un lavoro finale che si chiama «Main» e aspetta tutti gli
 * altri. Queste prove leggono il file della CI con un vero lettore YAML, come
 * lo legge GitHub, e poi ESEGUONO lo script di quel lavoro con gli esiti che
 * GitHub gli passerebbe. Pretendono:
 *   ① un lavoro, uno solo, con nome esattamente «Main»;
 *   ② che aspetti TUTTI gli altri lavori — uno aggiunto domani e dimenticato
 *     fuori dal cancello fa diventare rossa la prova;
 *   ③ che giri sempre (`if: always()`): senza, quando un lavoro fallisce
 *     GitHub lo salta, e un controllo obbligatorio saltato per la regola vale
 *     come passato;
 *   ④ che esca rosso quando un lavoro e' fallito o annullato, verde quando sono
 *     passati tutti, verde anche se uno e' stato saltato, e rosso se non ha
 *     guardato niente.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
// Il nome che la regola pretende sta in un posto solo: lo script che controlla
// la regola vera. Se qualcuno rinomina il lavoro qui, o il nome la', questa
// prova diventa rossa.
import { CONTROLLO_RICHIESTO } from '@/scripts/controlla-regola-main.mjs';

// Il lettore YAML e' quello che il progetto ha gia' fra le dipendenze di
// sviluppo (lo porta eslint). Se un giorno sparisce, questo `require` fallisce
// e la prova diventa rossa: non si trasforma in un verde che non ha letto niente.
const richiedi = createRequire(import.meta.url);
const yaml = richiedi('js-yaml') as { load: (testo: string) => unknown };

type Passo = { name?: string; run?: string; env?: Record<string, string>; 'continue-on-error'?: unknown };
type Lavoro = {
  name?: string;
  needs?: string | string[];
  if?: unknown;
  'continue-on-error'?: unknown;
  steps?: Passo[];
};

const PERCORSO = join(process.cwd(), '.github/workflows/ci.yml');

function lavoriDellaCi(): Record<string, Lavoro> {
  const documento = yaml.load(readFileSync(PERCORSO, 'utf8')) as { jobs?: Record<string, Lavoro> };
  if (!documento?.jobs || Object.keys(documento.jobs).length < 2) {
    throw new Error('Non ho trovato i lavori in .github/workflows/ci.yml: il lettore non sta capendo il file');
  }
  return documento.jobs;
}

/** Il lavoro che produce il controllo «Main», con il suo identificativo. */
function cancello(): { id: string; lavoro: Lavoro } {
  const lavori = lavoriDellaCi();
  const trovati = Object.entries(lavori).filter(([, l]) => l.name === CONTROLLO_RICHIESTO);
  if (trovati.length !== 1) {
    throw new Error(`Mi aspetto UN lavoro di nome «Main», ne ho trovati ${trovati.length}`);
  }
  return { id: trovati[0][0], lavoro: trovati[0][1] };
}

/** `${{ always() }}` e `always()` sono la stessa cosa per GitHub. */
function condizione(valore: unknown): string {
  return String(valore ?? '')
    .replace(/^\$\{\{\s*/, '')
    .replace(/\s*\}\}$/, '')
    .replace(/\s+/g, '');
}

function passoCheDecide(lavoro: Lavoro): Passo {
  const conScript = (lavoro.steps ?? []).filter((p) => typeof p.run === 'string');
  if (conScript.length !== 1) {
    throw new Error(`Il lavoro «Main» deve avere un passo solo con uno script, ne ha ${conScript.length}`);
  }
  return conScript[0];
}

/**
 * Esegue lo script vero del lavoro «Main» come lo esegue GitHub su Linux
 * (`bash -e`), con ESITI scritto come lo scrive `toJSON(needs)`.
 */
function esegui(esiti: string) {
  const passo = passoCheDecide(cancello().lavoro);
  const esito = spawnSync('bash', ['-e', '-c', passo.run as string], {
    encoding: 'utf8',
    env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '', ESITI: esiti, GITHUB_STEP_SUMMARY: '/dev/null' },
  });
  return { uscita: esito.status ?? -1, uscitaTesto: `${esito.stdout}\n${esito.stderr}` };
}

/** Come scrive GitHub `toJSON(needs)`: un oggetto per lavoro, con il suo `result`. */
function comeLiScriveGithub(risultati: Record<string, string>): string {
  const oggetto: Record<string, { result: string; outputs: Record<string, string> }> = {};
  for (const [id, result] of Object.entries(risultati)) oggetto[id] = { result, outputs: {} };
  return JSON.stringify(oggetto, null, 2);
}

function tuttiA(esito: string): Record<string, string> {
  const { id } = cancello();
  const risultati: Record<string, string> = {};
  for (const altro of Object.keys(lavoriDellaCi())) if (altro !== id) risultati[altro] = esito;
  return risultati;
}

describe('il controllo «Main» che la regola di GitHub pretende', () => {
  it('esiste un lavoro, uno solo, che si chiama esattamente «Main»', () => {
    const { lavoro } = cancello();
    expect(CONTROLLO_RICHIESTO).toBe('Main');
    expect(lavoro.name).toBe('Main');
  });

  it('aspetta TUTTI gli altri lavori della CI, nessuno escluso', () => {
    const { id, lavoro } = cancello();
    const aspettati = new Set(Array.isArray(lavoro.needs) ? lavoro.needs : lavoro.needs ? [lavoro.needs] : []);
    const altri = Object.keys(lavoriDellaCi()).filter((l) => l !== id);

    const dimenticati = altri.filter((l) => !aspettati.has(l));
    const inesistenti = [...aspettati].filter((l) => !altri.includes(l));
    expect(dimenticati, `lavori fuori dal cancello: ${dimenticati.join(', ')}`).toEqual([]);
    expect(inesistenti, `lavori aspettati che non esistono: ${inesistenti.join(', ')}`).toEqual([]);
    expect(altri.length).toBeGreaterThanOrEqual(5);
  });

  it('gira sempre, anche quando un lavoro aspettato e\' fallito', () => {
    const { lavoro } = cancello();
    expect(condizione(lavoro.if)).toBe('always()');
  });

  it('non puo\' fallire «in silenzio»: niente continue-on-error', () => {
    const { lavoro } = cancello();
    expect(lavoro['continue-on-error']).toBeUndefined();
    for (const p of lavoro.steps ?? []) expect(p['continue-on-error']).toBeUndefined();
  });

  it('riceve da GitHub l\'esito di ogni lavoro aspettato', () => {
    const passo = passoCheDecide(cancello().lavoro);
    expect(condizione(passo.env?.ESITI)).toBe('toJSON(needs)');
  });

  it('da\' il via libera quando tutti i controlli sono passati', () => {
    const { uscita, uscitaTesto } = esegui(comeLiScriveGithub(tuttiA('success')));
    expect(uscita, uscitaTesto).toBe(0);
  });

  it('un lavoro saltato non blocca (per esempio gli e2e senza segreti)', () => {
    const risultati = { ...tuttiA('success'), 'e2e-tests': 'skipped' };
    const { uscita, uscitaTesto } = esegui(comeLiScriveGithub(risultati));
    expect(uscita, uscitaTesto).toBe(0);
  });

  it('resta chiuso se UNO qualsiasi dei lavori e\' fallito o e\' stato annullato', () => {
    for (const lavoro of Object.keys(tuttiA('success'))) {
      for (const esitoCattivo of ['failure', 'cancelled']) {
        const { uscita, uscitaTesto } = esegui(comeLiScriveGithub({ ...tuttiA('success'), [lavoro]: esitoCattivo }));
        expect(uscita, `${lavoro}=${esitoCattivo} ha dato il via libera:\n${uscitaTesto}`).not.toBe(0);
        expect(uscitaTesto).toContain(`${lavoro} (${esitoCattivo})`);
      }
    }
  });

  it('resta chiuso anche quando il fallito sta in mezzo a lavori saltati', () => {
    const risultati = { ...tuttiA('skipped'), 'unit-tests': 'failure' };
    const { uscita } = esegui(comeLiScriveGithub(risultati));
    expect(uscita).not.toBe(0);
  });

  it('non da\' il via libera se tutti i lavori sono stati saltati: nessuno ha guardato niente', () => {
    const { uscita, uscitaTesto } = esegui(comeLiScriveGithub(tuttiA('skipped')));
    expect(uscita, uscitaTesto).not.toBe(0);
  });

  it('non da\' il via libera su un esito che non conosce', () => {
    const { uscita } = esegui(comeLiScriveGithub({ ...tuttiA('success'), a11y: 'neutral' }));
    expect(uscita).not.toBe(0);
  });

  it('non da\' il via libera se l\'esito dei lavori manca o non si legge', () => {
    for (const esiti of ['', '{}', 'null', 'non e\' JSON']) {
      const { uscita } = esegui(esiti);
      expect(uscita, `ESITI=${JSON.stringify(esiti)} ha dato il via libera`).not.toBe(0);
    }
  });
});
