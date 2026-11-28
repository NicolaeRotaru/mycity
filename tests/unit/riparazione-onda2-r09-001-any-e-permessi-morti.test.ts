import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createRequire } from 'node:module';

/**
 * R09-001 — Il tipo «qualunque» (any) e i permessi di saltare il controllo che non saltano niente.
 *
 *  ① Le direttive `eslint-disable` morte (28, quasi tutte per `@next/next/no-img-element`, regola
 *    spenta) sono tolte, e lo script `lint` le tratta come ERRORI (`--report-unused-disable-directives`):
 *    una direttiva nuova che non serve rompe il lint invece di accumularsi.
 *  ② L'elenco dei file in cui `no-explicit-any` è solo un avviso si accorcia: tolti i file tipizzati
 *    (le tre mappe Leaflet, i coriandoli, Turnstile, captureError, le due pagine d'ordine). Ogni file
 *    rimasto nell'elenco deve avere ancora almeno un any: un file ripulito esce dall'elenco, e lì
 *    un any nuovo è un errore. Il numero di any rimasti non può crescere.
 */

// eslint 8 non ha i suoi tipi qui: se ne descrive solo la parte che serve.
type Messaggio = { ruleId: string | null; severity: number; message: string };
type Risultato = { filePath: string; messages: Messaggio[] };
type MotoreEslint = {
  lintFiles(file: string[]): Promise<Risultato[]>;
  lintText(testo: string, opzioni: { filePath: string }): Promise<Risultato[]>;
};
const { ESLint } = createRequire(__filename)('eslint') as {
  ESLint: new (opzioni: { cwd: string; cache: boolean; reportUnusedDisableDirectives?: 'error' | 'warn' }) => MotoreEslint;
};

const ROOT = join(__dirname, '..', '..');
const REGOLA = '@typescript-eslint/no-explicit-any';
const ANY_RIMASTI_AL_PIU = 22;
const RIPULITI = [
  'app/rider/orders/[id]/page.tsx',
  'app/seller/orders/[id]/page.tsx',
  'components/ConfettiBurst.tsx',
  'components/DeliveryMap.tsx',
  'components/NearbyStoresMap.tsx',
  'components/StoreLocationPicker.tsx',
  'components/Turnstile.tsx',
  'lib/analytics/sentry.tsx',
];

function sorgenti(dir: string, out: string[] = []): string[] {
  for (const nome of readdirSync(join(ROOT, dir))) {
    if (nome === 'node_modules' || nome.startsWith('.')) continue;
    const rel = join(dir, nome);
    if (statSync(join(ROOT, rel)).isDirectory()) sorgenti(rel, out);
    else if (/\.(ts|tsx)$/.test(nome)) out.push(rel);
  }
  return out;
}

/** I file dell'override di .eslintrc.json che abbassa no-explicit-any ad avviso. */
function elencoAdAvviso(): string[] {
  const config = JSON.parse(readFileSync(join(ROOT, '.eslintrc.json'), 'utf8')) as {
    overrides: Array<{ files: string[]; rules?: Record<string, unknown> }>;
  };
  const o = config.overrides.find((x) => x.rules?.[REGOLA] === 'warn');
  return (o?.files ?? []).map((f) => f.replace(/\\/g, ''));
}

describe('R09-001 — ① niente permessi morti, e il lint li rifiuta', () => {
  it('lo script lint tratta le direttive inutili come errori', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts.lint).toContain('--report-unused-disable-directives');
    expect(pkg.scripts.lint).toMatch(/ app components lib$/);
  });

  it('nessuna direttiva eslint-disable inutile in app, components e lib', async () => {
    const conDirettive = ['app', 'components', 'lib']
      .flatMap((d) => sorgenti(d))
      .filter((f) => readFileSync(join(ROOT, f), 'utf8').includes('eslint-disable'));
    expect(conDirettive.length).toBeGreaterThan(0);
    const eslint = new ESLint({ cwd: ROOT, cache: false, reportUnusedDisableDirectives: 'error' });
    const risultati = await eslint.lintFiles(conDirettive.map((f) => join(ROOT, f)));
    const morte = risultati.flatMap((r) =>
      r.messages
        .filter((m) => m.ruleId === null && /Unused eslint-disable directive/.test(m.message))
        .map((m) => `${relative(ROOT, r.filePath)}: ${m.message}`),
    );
    expect(morte).toEqual([]);
  }, 60_000);
});

describe('R09-001 — ② l’elenco degli any ad avviso si accorcia e non si riempie', () => {
  it('i file ripuliti non sono più nell’elenco: lì un any nuovo è un errore', async () => {
    const elenco = elencoAdAvviso();
    const eslint = new ESLint({ cwd: ROOT, cache: false });
    for (const f of RIPULITI) {
      expect(elenco, f).not.toContain(f);
      const [r] = await eslint.lintText('export const x: any = 1;\n', { filePath: join(ROOT, f) });
      expect(r!.messages.find((m) => m.ruleId === REGOLA)?.severity, f).toBe(2);
    }
  }, 60_000);

  it('ogni file rimasto nell’elenco ha ancora almeno un any, e in tutto non crescono', async () => {
    const elenco = elencoAdAvviso();
    const eslint = new ESLint({ cwd: ROOT, cache: false });
    const risultati = await eslint.lintFiles(elenco.map((f) => join(ROOT, f)));
    const perFile = new Map(risultati.map((r) => [relative(ROOT, r.filePath), r.messages.filter((m) => m.ruleId === REGOLA).length]));
    const senzaAny = elenco.filter((f) => (perFile.get(f) ?? 0) === 0);
    expect(senzaAny, 'file ripuliti ma ancora nell elenco ad avviso: toglierli da .eslintrc.json').toEqual([]);
    const totale = [...perFile.values()].reduce((a, b) => a + b, 0);
    expect(totale).toBeLessThanOrEqual(ANY_RIMASTI_AL_PIU);
  }, 60_000);
});
