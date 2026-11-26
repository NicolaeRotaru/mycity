import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Le prove dell'acquisto vero non devono dare un verde a vuoto, nemmeno a livello di lavoro.
 *
 * Con E2E_DATI_DI_PROVA=1 ma senza le chiavi Stripe di prova, l'unico salto dello spec 12 fermava
 * tutte e tre le prove, anche il contrassegno che Stripe non lo usa: Playwright usciva 0 («3
 * skipped»), il lavoro «La cassa vera» era verde e il cancello di main lo contava fra i passati.
 *
 * Qui si pretende, ESEGUENDO i pezzi veri:
 *  ① il cancello di main (lo script del lavoro «Main» di ci.yml, con ESITI come lo scrive GitHub)
 *    non conta un verde con zero prove viste: lo dice «non conta», non lo fa rosso;
 *  ② il lavoro della cassa vera espone quante prove ha visto davvero, contate dal JSON di
 *    Playwright (passate + cadute + instabili) dallo stesso passo che scrive il riepilogo;
 *  ③ lo spec 12 fa girare il contrassegno con la sola E2E_DATI_DI_PROVA (e il database locale),
 *    e salta per Stripe solo le due prove con la carta.
 */

const richiedi = createRequire(import.meta.url);
const yaml = richiedi('js-yaml') as { load: (t: string) => unknown };

type Passo = { name?: string; id?: string; if?: unknown; run?: string; env?: Record<string, unknown> };
type Lavoro = { name?: string; needs?: string | string[]; outputs?: Record<string, string>; steps?: Passo[] };
type Flusso = { jobs?: Record<string, Lavoro> };

const flusso = () => yaml.load(readFileSync(join(process.cwd(), '.github/workflows/ci.yml'), 'utf8')) as Flusso;
const LAVORO = 'e2e-cassa-vera';

// ─── ① il cancello di main ─────────────────────────────────────────────────────────────────

function scriptDelCancello(): string {
  const lavori = flusso().jobs ?? {};
  const main = Object.values(lavori).find((l) => l.name === 'Main');
  const passo = (main?.steps ?? []).find((p) => typeof p.run === 'string');
  expect(passo?.run, 'il lavoro «Main» non ha lo script che decide').toBeTruthy();
  return passo!.run as string;
}

function altriLavori(): string[] {
  return Object.entries(flusso().jobs ?? {})
    .filter(([, l]) => l.name !== 'Main')
    .map(([id]) => id);
}

/** Come scrive GitHub `toJSON(needs)`: result e outputs per ogni lavoro aspettato. */
function esiti(lavori: Record<string, { result: string; outputs?: Record<string, string> }>): string {
  const o: Record<string, { result: string; outputs: Record<string, string> }> = {};
  for (const [id, v] of Object.entries(lavori)) o[id] = { result: v.result, outputs: v.outputs ?? {} };
  return JSON.stringify(o, null, 2);
}

function giraIlCancello(json: string) {
  const g = spawnSync('bash', ['-e', '-c', scriptDelCancello()], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', ESITI: json, GITHUB_STEP_SUMMARY: '/dev/null' } as unknown as NodeJS.ProcessEnv,
  });
  return { uscita: g.status ?? -1, testo: `${g.stdout}\n${g.stderr}` };
}

function tuttiVerdi(cassa: { result: string; outputs?: Record<string, string> }) {
  const l: Record<string, { result: string; outputs?: Record<string, string> }> = {};
  for (const id of altriLavori()) l[id] = { result: 'success' };
  l[LAVORO] = cassa;
  return l;
}

describe('① il cancello di main non conta un verde con zero prove viste', () => {
  it('la cassa vera verde con viste=0: «non conta», e i passati sono gli altri', () => {
    const { uscita, testo } = giraIlCancello(esiti(tuttiVerdi({ result: 'success', outputs: { viste: '0' } })));
    expect(uscita, testo).toBe(0);
    expect(testo).toMatch(new RegExp(`${LAVORO}: verde ma nessuna prova vista, non conta`));
    expect(testo, 'la cassa vera vuota contata fra i passati').not.toMatch(new RegExp(`✅ ${LAVORO}\\b`));
    expect(testo).toContain(`Via libera: ${altriLavori().length - 1} controlli passati.`);
  });

  it('se è l\'unico verde ed è vuoto, nessun via libera: nessuno ha guardato niente', () => {
    const l: Record<string, { result: string; outputs?: Record<string, string> }> = {};
    for (const id of altriLavori()) l[id] = { result: 'skipped' };
    l[LAVORO] = { result: 'success', outputs: { viste: '0' } };
    const { uscita, testo } = giraIlCancello(esiti(l));
    expect(uscita, `tre prove saltate davano il via libera a main:\n${testo}`).not.toBe(0);
  });

  it('un output vuoto (il passo non l\'ha scritto) non conta come visto', () => {
    const { testo } = giraIlCancello(esiti(tuttiVerdi({ result: 'success', outputs: { viste: '' } })));
    expect(testo).toMatch(new RegExp(`${LAVORO}: verde ma nessuna prova vista, non conta`));
  });

  it('con prove viste si conta come prima, e i lavori senza `viste` non cambiano', () => {
    const { uscita, testo } = giraIlCancello(esiti(tuttiVerdi({ result: 'success', outputs: { viste: '1' } })));
    expect(uscita, testo).toBe(0);
    expect(testo).toContain(`✅ ${LAVORO}`);
    expect(testo).toContain(`Via libera: ${altriLavori().length} controlli passati.`);
  });

  it('saltata o caduta resta com\'era: saltata non blocca, caduta ferma', () => {
    expect(giraIlCancello(esiti(tuttiVerdi({ result: 'skipped' }))).uscita).toBe(0);
    const caduta = giraIlCancello(esiti(tuttiVerdi({ result: 'failure', outputs: { viste: '1' } })));
    expect(caduta.uscita).not.toBe(0);
    expect(caduta.testo).toContain(`${LAVORO} (failure)`);
  });
});

// ─── ② il lavoro dice quante prove ha visto ──────────────────────────────────────────────

function passoDelRiepilogo(): Passo {
  const l = flusso().jobs?.[LAVORO];
  const passo = (l?.steps ?? []).find((p) => typeof p.run === 'string' && /GITHUB_STEP_SUMMARY/.test(p.run) && /acquisto vero/i.test(p.run));
  expect(passo, 'manca il passo che scrive cosa ha visto la cassa vera').toBeTruthy();
  return passo as Passo;
}

/** Esegue il passo vero del riepilogo in una cartella con il JSON di Playwright dato; torna GITHUB_OUTPUT. */
function giraIlRiepilogo(rapporto: unknown | null): string {
  const cartella = mkdtempSync(join(tmpdir(), 'r27-cassa-vera-'));
  try {
    if (rapporto !== null) writeFileSync(join(cartella, 'risultati-cassa-vera.json'), JSON.stringify(rapporto));
    const uscite = join(cartella, 'output');
    writeFileSync(uscite, '');
    const g = spawnSync('bash', ['-e', '-c', passoDelRiepilogo().run as string], {
      cwd: cartella,
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', GITHUB_STEP_SUMMARY: join(cartella, 'riepilogo'), GITHUB_OUTPUT: uscite } as unknown as NodeJS.ProcessEnv,
    });
    expect(g.status, g.stderr).toBe(0);
    return readFileSync(uscite, 'utf8');
  } finally {
    rmSync(cartella, { recursive: true, force: true });
  }
}

const spec = (titolo: string, status: string) => ({ title: titolo, tests: [{ status, annotations: [] }] });

describe('② il lavoro della cassa vera espone le prove viste davvero', () => {
  it('il lavoro dichiara l\'uscita `viste`, presa dal passo del riepilogo', () => {
    const l = flusso().jobs?.[LAVORO];
    const passo = passoDelRiepilogo();
    expect(passo.id, 'il passo del riepilogo non ha un id: la sua uscita non si legge').toBeTruthy();
    expect(String(l?.outputs?.viste ?? ''), 'il lavoro non espone quante prove ha visto').toContain(`steps.${passo.id}.outputs.viste`);
    expect(String(passo.if ?? '')).toMatch(/always\(\)/);
  });

  it('tre saltate: viste=0', () => {
    const out = giraIlRiepilogo({
      suites: [{ specs: [spec('a', 'skipped'), spec('b', 'skipped'), spec('c', 'skipped')] }],
      stats: { expected: 0, unexpected: 0, flaky: 0, skipped: 3 },
    });
    expect(out).toMatch(/^viste=0$/m);
  });

  it('il contrassegno passato e due saltate: viste=1; una caduta conta come vista', () => {
    expect(giraIlRiepilogo({ suites: [], stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 2 } })).toMatch(/^viste=1$/m);
    expect(giraIlRiepilogo({ suites: [], stats: { expected: 1, unexpected: 1, flaky: 1, skipped: 0 } })).toMatch(/^viste=3$/m);
  });

  it('nessun risultato di Playwright: viste=0', () => {
    expect(giraIlRiepilogo(null)).toMatch(/^viste=0$/m);
  });
});

// ─── ③ lo spec: il contrassegno non aspetta Stripe ───────────────────────────────────────

type TestJson = { status?: string; annotations?: { type?: string; description?: string }[]; results?: { error?: { message?: string } }[] };
type SpecJson = { title?: string; tests?: TestJson[] };
type SuiteJson = { specs?: SpecJson[]; suites?: SuiteJson[] };
const tutte = (s: SuiteJson, fuori: SpecJson[] = []): SpecJson[] => {
  for (const x of s.specs ?? []) fuori.push(x);
  for (const f of s.suites ?? []) tutte(f, fuori);
  return fuori;
};

/** Le variabili che lo spec legge: tolte tutte, poi rimesse finte. Niente di vero arriva a Playwright. */
const LETTE = [
  'E2E_DATI_DI_PROVA', 'E2E_BASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
  'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'E2E_STRIPE_CONTO_NEGOZIO', 'CRON_SECRET',
];

describe('③ con la sola E2E_DATI_DI_PROVA (e il database locale) il contrassegno gira', () => {
  it('senza le chiavi Stripe: il contrassegno prova a far nascere l ordine, le due con la carta si saltano dicendolo', () => {
    const env: Record<string, string | undefined> = { ...process.env, CI: '1' };
    for (const k of LETTE) delete env[k];
    Object.assign(env, {
      E2E_DATI_DI_PROVA: '1',
      E2E_BASE_URL: 'http://127.0.0.1:9',
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:9',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'chiave-anonima-finta',
      SUPABASE_SERVICE_ROLE_KEY: 'chiave-di-servizio-finta',
      CRON_SECRET: 'cron-finto',
    });
    const g = spawnSync(
      join(process.cwd(), 'node_modules/.bin/playwright'),
      ['test', 'tests/e2e/12-la-cassa-dal-carrello-al-pagamento.spec.ts', '--project=chromium', '--retries=0', '--reporter=json',
        '-g', 'nasce e il negozio|il rimborso esiste|il bonifico al negozio'],
      { cwd: process.cwd(), encoding: 'utf8', timeout: 55_000, env: env as NodeJS.ProcessEnv },
    );
    const uscita = g.stdout ?? '';
    expect(uscita.indexOf('{'), `Playwright non ha scritto il JSON:\n${g.stderr}`).toBeGreaterThanOrEqual(0);
    const rapporto = JSON.parse(uscita.slice(uscita.indexOf('{'))) as { suites?: SuiteJson[] };
    const prove = new Map((rapporto.suites ?? []).flatMap((s) => tutte(s)).map((s) => [s.title, s.tests?.[0]]));
    expect([...prove.keys()].sort()).toEqual([
      'consegna completata: il bonifico al negozio parte',
      'contrassegno: l\'ordine nasce e il negozio lo vede',
      'rifiuto del negozio su un ordine pagato: il rimborso esiste',
    ]);

    const contanti = prove.get('contrassegno: l\'ordine nasce e il negozio lo vede');
    expect(contanti?.status, 'il contrassegno, che Stripe non lo usa, si saltava per una chiave Stripe che manca').toBe('unexpected');
    const errore = (contanti?.results ?? []).map((r) => r.error?.message ?? '').join('\n');
    expect(errore, 'il contrassegno è caduto, ma non provando a raggiungere il database di prova').toMatch(/fetch failed|ECONNREFUSED/i);

    for (const titolo of ['rifiuto del negozio su un ordine pagato: il rimborso esiste', 'consegna completata: il bonifico al negozio parte']) {
      const t = prove.get(titolo);
      expect(t?.status, `«${titolo}» senza Stripe di prova non deve girare`).toBe('skipped');
      expect((t?.annotations ?? []).find((a) => a.type === 'skip')?.description ?? '').toMatch(/STRIPE_SECRET_KEY sk_test_/);
    }
  }, 60_000);
});
