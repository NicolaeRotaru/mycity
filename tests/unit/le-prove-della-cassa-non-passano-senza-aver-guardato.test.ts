import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 26/10/2026 — LE PROVE DELLA CASSA NON PASSANO SENZA AVER GUARDATO.
 *
 * Il difetto: in tests/e2e/12-la-cassa-dal-carrello-al-pagamento.spec.ts tre
 * prove dai nomi rassicuranti («contrassegno: l'ordine nasce…», «il rimborso
 * esiste», «il bonifico al negozio parte») avevano per corpo intero
 * `expect(SENZA_AMBIENTE_DI_PROVA).toBe(false)`. Il giorno in cui qualcuno
 * accende E2E_DATI_DI_PROVA diventano VERDI in tre millesimi senza aver creato
 * un ordine ne' toccato Stripe: controllavano l'interruttore, non la cassa.
 * Dall'1/11 erano gusci vuoti `async () => {}` dichiarati saltati.
 *
 * 16/11/2026 (R29-001) — ADESSO SI PRETENDE CHE GUARDINO. Le tre prove hanno il
 * corpo vero: seminano negozio, prodotto e cliente nel database di prova,
 * chiamano le rotte della cassa e leggono l'ordine. Qui le si fa girare DAVVERO
 * con Playwright, con l'interruttore acceso e un ambiente dichiarato pronto ma
 * FINTO e irraggiungibile (database e sito su 127.0.0.1:9, chiavi inventate):
 *  - una prova che guarda prova a far nascere l'ordine, non ci riesce, e CADE
 *    dicendo che non raggiunge il database o il sito;
 *  - un guscio vuoto passerebbe («expected») e uno saltato resterebbe
 *    «skipped»: tutti e due fanno diventare rossa questa prova.
 * Nessun valore vero arriva a Playwright: ogni variabile che le prove leggono
 * e' sovrascritta qui sotto con un valore finto. Si puo' fare senza browser: con
 * CI=1 la configurazione non avvia il server, e le tre prove usano solo
 * `request`, che non apre nessun browser.
 *
 * Due controprove: senza l'interruttore le tre prove restano saltate con il
 * motivo; con un database che non e' locale si saltano dicendolo e non scrivono
 * da nessuna parte (verso un indirizzo vero non si semina mai).
 */

type TestJson = {
  status?: string;
  annotations?: { type?: string; description?: string }[];
  results?: { error?: { message?: string }; errors?: { message?: string }[] }[];
};
type SpecJson = { title?: string; tests?: TestJson[] };
type SuiteJson = { specs?: SpecJson[]; suites?: SuiteJson[] };

const TITOLI = [
  'consegna completata: il bonifico al negozio parte',
  'contrassegno: l\'ordine nasce e il negozio lo vede',
  'rifiuto del negozio su un ordine pagato: il rimborso esiste',
];

/** Un ambiente che dice di essere pronto, ma dove niente risponde. */
const AMBIENTE_FINTO_E_IRRAGGIUNGIBILE: Record<string, string> = {
  E2E_DATI_DI_PROVA: '1',
  E2E_BASE_URL: 'http://127.0.0.1:9',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:9',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'chiave-anonima-finta',
  SUPABASE_SERVICE_ROLE_KEY: 'chiave-di-servizio-finta',
  STRIPE_SECRET_KEY: 'sk_test_chiave_finta_della_guardia',
  STRIPE_WEBHOOK_SECRET: 'firma-finta-della-guardia',
  E2E_STRIPE_CONTO_NEGOZIO: 'acct_contofintodellaguardia',
  CRON_SECRET: 'cron-finto-della-guardia',
};

function tutteLeSpec(suite: SuiteJson, fuori: SpecJson[] = []): SpecJson[] {
  for (const s of suite.specs ?? []) fuori.push(s);
  for (const figlia of suite.suites ?? []) tutteLeSpec(figlia, fuori);
  return fuori;
}

function giraLeTre(ambiente: Record<string, string | undefined>): SpecJson[] {
  const env: Record<string, string | undefined> = { ...process.env, CI: '1' };
  // Prima si tolgono tutte le variabili che le prove leggono: un valore vero della macchina
  // (un database, una chiave) non deve mai arrivare a Playwright da qui.
  for (const k of Object.keys(AMBIENTE_FINTO_E_IRRAGGIUNGIBILE)) delete env[k];
  for (const [k, v] of Object.entries(ambiente)) if (v !== undefined) env[k] = v;
  const esecuzione = spawnSync(
    join(process.cwd(), 'node_modules/.bin/playwright'),
    [
      'test',
      'tests/e2e/12-la-cassa-dal-carrello-al-pagamento.spec.ts',
      '--project=chromium',
      '--retries=0',
      '--reporter=json',
      '-g',
      'nasce e il negozio|il rimborso esiste|il bonifico al negozio',
    ],
    { cwd: process.cwd(), encoding: 'utf8', timeout: 55_000, env: env as NodeJS.ProcessEnv },
  );
  const uscita = esecuzione.stdout ?? '';
  const inizio = uscita.indexOf('{');
  expect(inizio, `Playwright non ha scritto il JSON:\n${esecuzione.stderr}`).toBeGreaterThanOrEqual(0);
  const rapporto = JSON.parse(uscita.slice(inizio)) as { suites?: SuiteJson[] };
  const spec = (rapporto.suites ?? []).flatMap((s) => tutteLeSpec(s));
  // Guardia: un -g che non prende niente farebbe passare tutto a vuoto.
  expect(spec.map((s) => s.title).sort()).toEqual(TITOLI);
  return spec;
}

const erroreDi = (t: TestJson | undefined) =>
  (t?.results ?? []).flatMap((r) => [r.error?.message ?? '', ...(r.errors ?? []).map((e) => e.message ?? '')]).join('\n');
const motivoDelSalto = (t: TestJson | undefined) => (t?.annotations ?? []).find((a) => a.type === 'skip')?.description ?? '';

describe('le tre prove dell acquisto vero', () => {
  it('con l ambiente dichiarato pronto provano a far nascere l ordine: senza database cadono, non passano e non si saltano', () => {
    for (const s of giraLeTre(AMBIENTE_FINTO_E_IRRAGGIUNGIBILE)) {
      const prova = s.tests?.[0];
      expect(prova?.status, `«${s.title}» con l'ambiente pronto deve guardare: un guscio passa («expected»), una saltata resta «skipped» (${motivoDelSalto(prova)})`).toBe('unexpected');
      // E cade perche' ha provato a raggiungere il database o il sito di prova, non per altro.
      expect(erroreDi(prova), `«${s.title}» e' caduta, ma non provando a raggiungere il database o il sito`).toMatch(/fetch failed|ECONNREFUSED|127\.0\.0\.1:9|connect/i);
    }
  }, 60_000);

  it('senza E2E_DATI_DI_PROVA restano saltate con il motivo, non verdi a vuoto', () => {
    const { E2E_DATI_DI_PROVA: _spento, ...resto } = AMBIENTE_FINTO_E_IRRAGGIUNGIBILE;
    for (const s of giraLeTre(resto)) {
      const prova = s.tests?.[0];
      expect(prova?.status, `«${s.title}» senza l'interruttore non deve girare`).toBe('skipped');
      expect(motivoDelSalto(prova), `«${s.title}» saltata senza dire perche'`).toMatch(/E2E_DATI_DI_PROVA/);
    }
  }, 60_000);

  it('con un database che non e\' quello locale di prova si saltano dicendolo, senza scrivere da nessuna parte', () => {
    for (const s of giraLeTre({ ...AMBIENTE_FINTO_E_IRRAGGIUNGIBILE, NEXT_PUBLIC_SUPABASE_URL: 'https://progetto-vero.supabase.co' })) {
      const prova = s.tests?.[0];
      expect(prova?.status, `«${s.title}» non deve seminare un database che non e' locale`).toBe('skipped');
      expect(motivoDelSalto(prova)).toMatch(/LOCALE/);
    }
  }, 60_000);
});
