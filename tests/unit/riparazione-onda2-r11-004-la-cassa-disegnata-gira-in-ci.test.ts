import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import ts from 'typescript';

/**
 * R11-004 — LA PROVA «LA CASSA DISEGNA IL MODULO» NON GIRAVA IN NESSUN LAVORO DELLA CI.
 *
 * In tests/e2e/12-la-cassa-dal-carrello-al-pagamento.spec.ts la prova che apre /checkout con la merce
 * nel carrello stava sotto il salto unico dell'acquisto vero, e nessun lavoro della CI la sceglieva:
 *  - «E2E smoke» e «Prove nel browser (senza chiavi)» girano tutto lo spec ma senza
 *    E2E_DATI_DI_PROVA: lì è sempre saltata;
 *  - «La cassa vera» accende E2E_DATI_DI_PROVA, ma il suo filtro `-g` prende solo le tre prove dei
 *    soldi («nasce e il negozio|il rimborso esiste|il bonifico al negozio»);
 *  - e anche scelta, si sarebbe saltata senza le chiavi di Stripe, che a lei non servono.
 * Peggio: se fosse girata sarebbe caduta. Seminava nel carrello del browser gli id inventati di
 * CARRELLO_DI_PROVA: la cassa rilegge ogni riga dal database e toglie quelle che non conosce
 * («non più disponibili»), e con il carrello vuoto il modulo non si disegna.
 *
 * Adesso: la prova semina il suo negozio e il suo prodotto nel database di prova e mette QUELLO nel
 * carrello; le basta il database (il salto per lei guarda solo quello); e il lavoro «La cassa vera»
 * la sceglie. Qui: la CI (un lavoro la sceglie con E2E_DATI_DI_PROVA accesa), lo spec (semina e usa il
 * prodotto vero), e Playwright vero con un ambiente finto e irraggiungibile (con il solo database
 * dichiarato pronto la prova parte e prova a raggiungerlo; senza interruttore o con un database non
 * locale si salta dicendolo).
 */

const richiedi = createRequire(import.meta.url);
const yaml = richiedi('js-yaml') as { load: (t: string) => unknown };

const SPEC = 'tests/e2e/12-la-cassa-dal-carrello-al-pagamento.spec.ts';
const TITOLO = 'la cassa disegna il modulo con la merce riletta dal database';

// ─── ① la CI la sceglie ─────────────────────────────────────────────────────────────────────────

type Passo = { name?: string; run?: string; env?: Record<string, unknown> };
type Lavoro = { name?: string; if?: unknown; env?: Record<string, unknown>; steps?: Passo[] };
type Flusso = { env?: Record<string, unknown>; jobs?: Record<string, Lavoro> };

/** Il filtro `-g "…"` (o `--grep`) di un comando Playwright, se c'è. */
function filtro(run: string): RegExp | null {
  const m = /(?:^|\s)(?:-g|--grep)[\s=]+(?:"([^"]*)"|'([^']*)'|(\S+))/.exec(run);
  const testo = m ? (m[1] ?? m[2] ?? m[3]) : null;
  return testo == null ? null : new RegExp(testo);
}

/** I lavori in cui la prova della cassa disegnata è scelta e ha l'interruttore acceso. */
function lavoriCheLaFannoGirare(f: Flusso): string[] {
  const out: string[] = [];
  for (const [nome, l] of Object.entries(f.jobs ?? {})) {
    for (const p of l.steps ?? []) {
      const run = p.run ?? '';
      const lanciaPlaywright = /playwright test|npm run test:e2e/.test(run);
      if (!lanciaPlaywright) continue;
      // Lo spec è nel comando, oppure il comando non nomina file di prove (gira la cartella intera).
      const nominaFile = /tests\/e2e\/\S+\.spec\.ts/.test(run);
      if (nominaFile && !run.includes(SPEC)) continue;
      const g = filtro(run);
      if (g && !g.test(TITOLO)) continue;
      const acceso = String(p.env?.E2E_DATI_DI_PROVA ?? l.env?.E2E_DATI_DI_PROVA ?? f.env?.E2E_DATI_DI_PROVA ?? '');
      if (acceso === '1') out.push(nome);
    }
  }
  return out;
}

describe('R11-004 · ① un lavoro della CI fa girare «la cassa disegna il modulo»', () => {
  it('il filtro del lavoro della cassa vera la sceglie, con E2E_DATI_DI_PROVA accesa', () => {
    const f = yaml.load(readFileSync('.github/workflows/ci.yml', 'utf8')) as Flusso;
    expect(lavoriCheLaFannoGirare(f), 'nessun lavoro sceglie la prova con l interruttore acceso: in CI è sempre saltata').toContain('e2e-cassa-vera');
  });

  it('controprova: il filtro di prima («nasce e il negozio|il rimborso esiste|il bonifico al negozio») non la sceglieva', () => {
    const vecchio = { jobs: { x: { steps: [{ run: `npx playwright test ${SPEC} -g "nasce e il negozio|il rimborso esiste|il bonifico al negozio"`, env: { E2E_DATI_DI_PROVA: '1' } }] } } };
    expect(lavoriCheLaFannoGirare(vecchio)).toEqual([]);
  });
});

// ─── ② lo spec semina il prodotto che mette nel carrello ────────────────────────────────────────

function corpoDellaProva(): string {
  const f = ts.createSourceFile('12.ts', readFileSync(SPEC, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const corpi: string[] = [];
  const visita = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'test' && n.arguments.length >= 2) {
      const t = n.arguments[0];
      if ((ts.isStringLiteral(t) || ts.isNoSubstitutionTemplateLiteral(t)) && t.text === TITOLO) corpi.push(n.arguments[n.arguments.length - 1].getText(f));
    }
    ts.forEachChild(n, visita);
  };
  visita(f);
  expect(corpi, `«${TITOLO}» non c'è più nello spec, o c'è due volte`).toHaveLength(1);
  return corpi[0];
}

describe('R11-004 · ② la prova mette nel carrello un prodotto che il database conosce', () => {
  it('semina negozio e prodotto nel database di prova e mette nel carrello quel prodotto, non gli id inventati', () => {
    const corpo = corpoDellaProva();
    expect(corpo, 'senza seminare il prodotto la cassa lo toglie dal carrello («non più disponibile»)').toMatch(/preparaLaBottega\(/);
    expect(corpo).toMatch(/prodottoId/);
    expect(corpo, 'gli id inventati di CARRELLO_DI_PROVA la cassa non li trova nel database').not.toMatch(/seminaIlCarrello\(page\)/);
    expect(corpo).toMatch(/page\.goto\('\/checkout'\)/);
    expect(corpo, 'la prova non guarda che la riga sia rimasta nel carrello').toMatch(/più disponibil/);
  });
});

// ─── ③ Playwright vero: le basta il database ────────────────────────────────────────────────────

type TestJson = {
  status?: string;
  annotations?: { type?: string; description?: string }[];
  results?: { error?: { message?: string }; errors?: { message?: string }[] }[];
};
type SpecJson = { title?: string; tests?: TestJson[] };
type SuiteJson = { specs?: SpecJson[]; suites?: SuiteJson[] };

/** Database e sito su 127.0.0.1:9 (non risponde nessuno), chiavi inventate, e NIENTE Stripe di prova. */
const SOLO_IL_DATABASE: Record<string, string> = {
  E2E_DATI_DI_PROVA: '1',
  E2E_BASE_URL: 'http://127.0.0.1:9',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:9',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'chiave-anonima-finta',
  SUPABASE_SERVICE_ROLE_KEY: 'chiave-di-servizio-finta',
  STRIPE_SECRET_KEY: 'sk_live_chiave_vera_mai_qui',
};
const DA_TOGLIERE = [...Object.keys(SOLO_IL_DATABASE), 'STRIPE_WEBHOOK_SECRET', 'E2E_STRIPE_CONTO_NEGOZIO', 'CRON_SECRET'];

function tutteLeSpec(s: SuiteJson, fuori: SpecJson[] = []): SpecJson[] {
  for (const x of s.specs ?? []) fuori.push(x);
  for (const figlia of s.suites ?? []) tutteLeSpec(figlia, fuori);
  return fuori;
}

function giraLaCassaDisegnata(ambiente: Record<string, string | undefined>): TestJson | undefined {
  const env: Record<string, string | undefined> = { ...process.env, CI: '1' };
  // Nessun valore vero della macchina (un database, una chiave) arriva a Playwright da qui.
  for (const k of DA_TOGLIERE) delete env[k];
  for (const [k, v] of Object.entries(ambiente)) if (v !== undefined) env[k] = v;
  const giro = spawnSync(
    join(process.cwd(), 'node_modules/.bin/playwright'),
    ['test', SPEC, '--project=chromium', '--retries=0', '--reporter=json', '-g', 'la cassa disegna il modulo'],
    { cwd: process.cwd(), encoding: 'utf8', timeout: 55_000, env: env as NodeJS.ProcessEnv },
  );
  const uscita = giro.stdout ?? '';
  const inizio = uscita.indexOf('{');
  expect(inizio, `Playwright non ha scritto il JSON:\n${giro.stderr}`).toBeGreaterThanOrEqual(0);
  const spec = ((JSON.parse(uscita.slice(inizio)) as { suites?: SuiteJson[] }).suites ?? []).flatMap((s) => tutteLeSpec(s));
  expect(spec.map((s) => s.title), 'il filtro non ha preso la prova (o ne ha prese altre)').toEqual([TITOLO]);
  return spec[0].tests?.[0];
}

const erroreDi = (t: TestJson | undefined) =>
  (t?.results ?? []).flatMap((r) => [r.error?.message ?? '', ...(r.errors ?? []).map((e) => e.message ?? '')]).join('\n');
const motivoDelSalto = (t: TestJson | undefined) => (t?.annotations ?? []).find((a) => a.type === 'skip')?.description ?? '';

describe('R11-004 · ③ la cassa disegnata gira col solo database di prova', () => {
  it('col database dichiarato pronto e senza Stripe di prova non si salta: parte e prova a raggiungere database o sito', () => {
    const prova = giraLaCassaDisegnata(SOLO_IL_DATABASE);
    expect(prova?.status, `con il database pronto la prova deve girare, invece: ${prova?.status} (${motivoDelSalto(prova)})`).toBe('unexpected');
    // Cade perché ha provato davvero: il browser che parte o la semina che non raggiunge il database
    // finto. Dove il browser non è installato (le prove unitarie della CI) cade lì, prima di seminare.
    expect(erroreDi(prova)).toMatch(/fetch failed|ECONNREFUSED|Executable doesn't exist|browserType\.launch/i);
  }, 60_000);

  it('senza E2E_DATI_DI_PROVA resta saltata dicendolo', () => {
    const { E2E_DATI_DI_PROVA: _spento, ...resto } = SOLO_IL_DATABASE;
    const prova = giraLaCassaDisegnata(resto);
    expect(prova?.status).toBe('skipped');
    expect(motivoDelSalto(prova)).toMatch(/E2E_DATI_DI_PROVA/);
  }, 60_000);

  it('con un database che non è quello locale di prova si salta dicendolo, senza seminare niente', () => {
    const prova = giraLaCassaDisegnata({ ...SOLO_IL_DATABASE, NEXT_PUBLIC_SUPABASE_URL: 'https://progetto-vero.supabase.co' });
    expect(prova?.status).toBe('skipped');
    expect(motivoDelSalto(prova)).toMatch(/LOCALE/);
  }, 60_000);
});
