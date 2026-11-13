import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

/**
 * R13-005 — LE TRE PROVE DELL'ACQUISTO VERO NON DIVENTANO VERDI A VUOTO DALLA CI.
 *
 * In tests/e2e/12-la-cassa-dal-carrello-al-pagamento.spec.ts tre prove dai nomi
 * rassicuranti (contrassegno, rimborso, bonifico) hanno il corpo vuoto e sono
 * dichiarate `test.skip(...)`: finché l'ambiente di prova non esiste, nessun
 * ordine nasce. Lo scenario della scheda: qualcuno accende `E2E_DATI_DI_PROVA`
 * in CI, la suite diventa «verde», tutti leggono «l'acquisto è provato» e si va
 * live senza che un'automazione abbia mai attraversato la cassa.
 *
 * Quello spec non è di R13 (serve_file_altrui per i corpi veri). La parte che
 * vive QUI è la CI (`.github/workflows/ci.yml`): questa guardia la legge con un
 * vero lettore YAML e tiene due invarianti, così la porta del «verde a vuoto»
 * non si riapre da sola:
 *  ① nessun livello della CI (workflow, lavoro, passo) ACCENDE
 *     `E2E_DATI_DI_PROVA` con un `env:`. Leggerla in uno script per dire che è
 *     spenta va bene; impostarla è la leva che renderebbe verdi i gusci vuoti.
 *  ② il lavoro e2e tiene un passo che gira SEMPRE e scrive nel riepilogo (lo
 *     stesso posto dove si guarda il verde) che le tre prove dell'acquisto vero
 *     NON sono girate.
 *
 * Il giorno che i corpi veri esistono e un lavoro di prova le fa girare, questa
 * guardia va riscritta perché pretenda un ordine nato, non più il salto.
 */

const richiedi = createRequire(import.meta.url);
const yaml = richiedi('js-yaml') as { load: (t: string) => unknown };

type Passo = { name?: string; if?: unknown; run?: string; env?: Record<string, unknown> };
type Lavoro = { env?: Record<string, unknown>; steps?: Passo[] };
type Flusso = { env?: Record<string, unknown>; jobs?: Record<string, Lavoro> };

const PERCORSO = join(process.cwd(), '.github/workflows/ci.yml');

function flusso(): Flusso {
  return yaml.load(readFileSync(PERCORSO, 'utf8')) as Flusso;
}

/** Ogni blocco `env:` del file: del workflow, di ogni lavoro, di ogni passo. */
function tuttiGliEnv(f: Flusso): Array<{ dove: string; env: Record<string, unknown> }> {
  const out: Array<{ dove: string; env: Record<string, unknown> }> = [];
  if (f.env) out.push({ dove: 'workflow', env: f.env });
  for (const [nomeLavoro, lavoro] of Object.entries(f.jobs ?? {})) {
    if (lavoro.env) out.push({ dove: `lavoro ${nomeLavoro}`, env: lavoro.env });
    for (const passo of lavoro.steps ?? []) {
      if (passo.env) out.push({ dove: `${nomeLavoro} › ${passo.name ?? 'passo'}`, env: passo.env });
    }
  }
  return out;
}

describe('R13-005 · la CI non apre la porta del «verde a vuoto»', () => {
  it('nessun env della CI accende E2E_DATI_DI_PROVA (la leva che renderebbe verdi i gusci vuoti)', () => {
    const colpevoli = tuttiGliEnv(flusso())
      .filter((b) => Object.prototype.hasOwnProperty.call(b.env, 'E2E_DATI_DI_PROVA'))
      .map((b) => b.dove);
    expect(
      colpevoli,
      'un env della CI imposta E2E_DATI_DI_PROVA: con i corpi delle tre prove ancora vuoti, questo le renderebbe verdi senza creare un ordine. Scrivi prima i corpi veri (tests/e2e/12) e aggiorna questa guardia.',
    ).toEqual([]);
  });

  it('una lettura della variabile in uno script non conta come averla accesa', () => {
    // Controprova della regola sopra: ci.yml la LEGGE già (`${E2E_DATI_DI_PROVA:-}`)
    // per dire che è spenta, e questo deve restare permesso.
    const testo = readFileSync(PERCORSO, 'utf8');
    expect(testo).toMatch(/E2E_DATI_DI_PROVA/);
    expect(tuttiGliEnv(flusso()).some((b) => 'E2E_DATI_DI_PROVA' in b.env)).toBe(false);
  });

  it('il lavoro e2e dichiara SEMPRE, nel riepilogo, che le tre prove dell\'acquisto vero non sono girate', () => {
    const lavoro = flusso().jobs?.['e2e-tests'];
    expect(lavoro, 'manca il lavoro e2e-tests').toBeTruthy();
    const avviso = (lavoro!.steps ?? []).find(
      (p) => typeof p.run === 'string' && /GITHUB_STEP_SUMMARY/.test(p.run) && /acquisto vero/i.test(p.run),
    );
    expect(
      avviso,
      'nessun passo del lavoro e2e scrive nel riepilogo che le tre prove dell\'acquisto vero non sono girate',
    ).toBeTruthy();
    // Deve girare SEMPRE: un avviso dietro a un `if: success()` sparisce proprio quando
    // la suite è «verde», cioè quando qualcuno sta per andare live.
    expect(String(avviso!.if ?? ''), 'l\'avviso non gira sempre: con la CI verde sparirebbe').toMatch(/always\(\)/);
    expect(avviso!.run).toMatch(/E2E_DATI_DI_PROVA/);
  });
});
