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
 *
 * Qui le si fa girare DAVVERO con Playwright, con l'interruttore acceso, e si
 * pretende che restino SALTATE con un motivo scritto. Si puo' fare senza
 * browser: con CI=1 la configurazione non avvia il server, e le tre prove non
 * chiedono `page`. Se per sbaglio servisse il browser, lo stato sarebbe
 * «unexpected» e questa prova resterebbe rossa: e' giusto.
 *
 * Il giorno che l'ambiente di prova esiste, si scrive il corpo vero delle tre e
 * si cambia questa prova perche' pretenda «expected» con dentro un ordine nato.
 */

type TestJson = { status?: string; annotations?: { type?: string; description?: string }[] };
type SpecJson = { title?: string; tests?: TestJson[] };
type SuiteJson = { specs?: SpecJson[]; suites?: SuiteJson[] };

function tutteLeSpec(suite: SuiteJson, fuori: SpecJson[] = []): SpecJson[] {
  for (const s of suite.specs ?? []) fuori.push(s);
  for (const figlia of suite.suites ?? []) tutteLeSpec(figlia, fuori);
  return fuori;
}

describe('le tre prove dell acquisto vero', () => {
  it('con E2E_DATI_DI_PROVA acceso restano saltate con il motivo, non verdi a vuoto', () => {
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
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 55_000,
        env: { ...process.env, CI: '1', E2E_DATI_DI_PROVA: '1', E2E_BASE_URL: 'http://127.0.0.1:9' },
      },
    );
    const uscita = esecuzione.stdout ?? '';
    const inizio = uscita.indexOf('{');
    expect(inizio, `Playwright non ha scritto il JSON:\n${esecuzione.stderr}`).toBeGreaterThanOrEqual(0);
    const rapporto = JSON.parse(uscita.slice(inizio)) as { suites?: SuiteJson[] };
    const spec = (rapporto.suites ?? []).flatMap((s) => tutteLeSpec(s));

    // Guardia: un -g che non prende niente farebbe passare tutto a vuoto.
    expect(spec.map((s) => s.title).sort()).toEqual([
        'consegna completata: il bonifico al negozio parte',
        'contrassegno: l\'ordine nasce e il negozio lo vede',
        'rifiuto del negozio su un ordine pagato: il rimborso esiste',
      ]);

    for (const s of spec) {
      const prova = s.tests?.[0];
      expect(prova?.status, `«${s.title}» non deve poter essere verde senza un corpo vero`).toBe('skipped');
      const motivo = (prova?.annotations ?? []).find((a) => a.type === 'skip')?.description ?? '';
      expect(motivo, `«${s.title}» saltata senza dire perche'`).toMatch(/NON ANCORA SCRITTA/);
    }
  }, 60_000);
});
