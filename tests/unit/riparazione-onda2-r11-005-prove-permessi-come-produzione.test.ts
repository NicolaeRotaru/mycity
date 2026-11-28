/**
 * R11-005 — Le prove dei permessi in SQL certificavano un database ricostruito dai file, non quello vero.
 *
 * La prima metà (onda 1) confronta le impronte delle regole fra il database vero e quello dai file.
 * Restava il pezzo che fa girare le PROVE sul database come la produzione l'ha:
 *
 * ① `scripts/check-migration-drift.mjs` con MANCANTI_ESPORTA=<file> scrive le migrazioni che il
 *   database collegato non ha, un nome di file per riga (vuoto se non ne manca nessuna);
 * ② `tests/sql/harness/apply.sh` con SALTA_MIGRAZIONI=<file> non applica e non registra quelle
 *   migrazioni; un file che non si legge ferma tutto (non si ricostruisce «tutti i file» di nascosto);
 * ③ il flusso notturno della deriva passa l'elenco dal passo dei nomi ad apply.sh, ricostruisce
 *   `mycity_come_produzione` sul Postgres del giro e ci fa girare tests/sql/harness/run.sh.
 *
 * Nessun database: lo script dei nomi gira con un `pg` finto (un aggancio di Node che risolve «pg»
 * su un file di prova) e apply.sh con un `psql` finto in testa al PATH, che scrive solo cosa gli si
 * chiede.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { elencoDelleMancanti, esitoDelConfronto } from '../../scripts/check-migration-drift.mjs';

const yaml = createRequire(import.meta.url)('js-yaml') as { load: (testo: string) => unknown };

const RADICE = process.cwd();
const CARTELLA = mkdtempSync(join(tmpdir(), 'onda2-r11-005-'));
afterAll(() => rmSync(CARTELLA, { recursive: true, force: true }));

// Tutti i file che apply.sh applica (byte per byte, come il suo `LC_ALL=C sort`), e quelli che lo script
// dei nomi riconosce (il suo NAME_RE: numero di tre cifre, lettera facoltativa, nome).
const MIGRAZIONI = readdirSync(join(RADICE, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
const NUMERATE = MIGRAZIONI.filter((f) => /^(\d{3}[a-z]?)_([a-z0-9_]+)\.sql$/.test(f));
// Due che «la produzione non ha»: la 161 (il caso vero di cui parla il flusso) e l'ultima numerata.
const NON_IN_PRODUZIONE = [NUMERATE.find((f) => f.startsWith('161_'))!, NUMERATE[NUMERATE.length - 1]];

/** Un `psql` finto: scrive in $REGISTRO_PSQL gli argomenti di ogni chiamata, una riga per chiamata. */
const BIN = join(CARTELLA, 'bin');
spawnSync('mkdir', ['-p', BIN]);
writeFileSync(join(BIN, 'psql'), '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$REGISTRO_PSQL"\nexit 0\n');
chmodSync(join(BIN, 'psql'), 0o755);

function apply(nome: string, env: Record<string, string>) {
  const registro = join(CARTELLA, `psql-${nome}.log`);
  writeFileSync(registro, '');
  const r = spawnSync('bash', [join(RADICE, 'tests/sql/harness/apply.sh'), nome], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${BIN}:${process.env.PATH}`,
      REGISTRO_PSQL: registro,
      // Anche se un psql vero sfuggisse al PATH, non troverebbe nessun server.
      PGHOST: join(CARTELLA, 'nessun-server'),
      PGPORT: '1',
      ...env,
    },
  });
  const chiamate = readFileSync(registro, 'utf8').split('\n').filter(Boolean);
  const applicate = chiamate.map((c) => c.match(/-f \S*\/migrations\/(\S+\.sql)/)?.[1]).filter((x): x is string => !!x);
  const registrate = chiamate.map((c) => c.match(/VALUES \('([^']+)', '([^']+)'\)/)).filter(Boolean).map((m) => `${m![1]}_${m![2]}.sql`);
  return { codice: r.status, uscita: `${r.stdout}${r.stderr}`, applicate, registrate, chiamate };
}

describe('② apply.sh salta le migrazioni che la produzione non ha', () => {
  it('con SALTA_MIGRAZIONI quelle non si applicano e non si registrano; tutte le altre sì', () => {
    const salta = join(CARTELLA, 'salta.txt');
    writeFileSync(salta, NON_IN_PRODUZIONE.map((f) => `${f}\n`).join(''));
    const r = apply('mycity_come_produzione', { SALTA_MIGRAZIONI: salta });
    expect(r.codice, r.uscita).toBe(0);
    for (const f of NON_IN_PRODUZIONE) {
      expect(r.applicate, `${f} si è applicata anche se la produzione non l'ha`).not.toContain(f);
      expect(r.registrate, `${f} si è registrata anche se la produzione non l'ha`).not.toContain(f);
    }
    expect(r.applicate).toEqual(MIGRAZIONI.filter((f) => !NON_IN_PRODUZIONE.includes(f)));
    expect(r.uscita).toMatch(/saltate 2 \(SALTA_MIGRAZIONI\)/);
  });

  it('un nome che è solo l’inizio di un altro non ne salta un altro (confronto della riga intera)', () => {
    const salta = join(CARTELLA, 'salta-pezzo.txt');
    writeFileSync(salta, `${NON_IN_PRODUZIONE[0].slice(0, 4)}\n`);
    const r = apply('mycity_pezzo', { SALTA_MIGRAZIONI: salta });
    expect(r.codice, r.uscita).toBe(0);
    expect(r.applicate).toEqual(MIGRAZIONI);
  });

  it('senza la variabile, come prima: tutte applicate e registrate, nessuna riga «saltate»', () => {
    const r = apply('mycity_dai_file', {});
    expect(r.codice, r.uscita).toBe(0);
    expect(r.applicate).toEqual(MIGRAZIONI);
    expect(r.registrate).toEqual(MIGRAZIONI);
    expect(r.uscita).not.toMatch(/saltate/);
  });

  it('un elenco che non si legge ferma tutto: niente database «tutti i file» spacciato per la produzione', () => {
    const r = apply('mycity_senza_elenco', { SALTA_MIGRAZIONI: join(CARTELLA, 'non-esiste.txt') });
    expect(r.codice).not.toBe(0);
    expect(r.chiamate, 'ha toccato il database pur senza elenco').toEqual([]);
    expect(r.uscita).toMatch(/SALTA_MIGRAZIONI=.*non si legge/);
  });
});

describe('① lo script dei nomi scrive l’elenco delle mancanti', () => {
  it('elencoDelleMancanti: un nome di file per riga, vuoto se non manca niente', () => {
    const repo = [
      { prefix: '160', name: 'a', file: '160_a.sql' },
      { prefix: '161', name: 'b', file: '161_b.sql' },
      { prefix: '162', name: 'c', file: '162_c.sql' },
    ];
    expect(elencoDelleMancanti(esitoDelConfronto(repo, [{ version: '160', name: 'a' }]))).toBe('161_b.sql\n162_c.sql\n');
    expect(elencoDelleMancanti(esitoDelConfronto(repo, repo.map((m) => ({ version: m.prefix, name: m.name }))))).toBe('');
  });

  /** Lancia lo script vero con un `pg` finto il cui registro ha tutte le migrazioni tranne `mancanti`. */
  function lanciaLoScript(mancanti: string[], esporta: string | null) {
    const righe = NUMERATE.filter((f) => !mancanti.includes(f)).map((f) => {
      const m = f.match(/^(\d{3}[a-z]?)_(.+)\.sql$/)!;
      return { version: m[1], name: m[2], statements: null };
    });
    const pgFinto = join(CARTELLA, `pg-finto-${mancanti.length}.mjs`);
    writeFileSync(pgFinto, `const righe = ${JSON.stringify(righe)};
export default { Client: class { async connect() {} async query() { return { rows: righe }; } async end() {} } };\n`);
    const aggancio = join(CARTELLA, `aggancio-${mancanti.length}.mjs`);
    writeFileSync(aggancio, `export async function resolve(spec, ctx, next) {
  if (spec === 'pg') return { url: ${JSON.stringify(pathToFileURL(pgFinto).href)}, shortCircuit: true };
  return next(spec, ctx);
}\n`);
    const registra = join(CARTELLA, `registra-${mancanti.length}.mjs`);
    writeFileSync(registra, `import { register } from 'node:module';\nregister(${JSON.stringify(pathToFileURL(aggancio).href)});\n`);
    const env: Record<string, string | undefined> = { ...process.env, SUPABASE_DB_URL: 'postgresql://finto:finto@127.0.0.1:1/finto', DATABASE_URL: undefined };
    delete env.PERMESSI_ESPORTA;
    delete env.PERMESSI_ATTESI;
    if (esporta) env.MANCANTI_ESPORTA = esporta;
    else delete env.MANCANTI_ESPORTA;
    return spawnSync(process.execPath, ['--import', pathToFileURL(registra).href, join(RADICE, 'scripts/check-migration-drift.mjs')], {
      cwd: RADICE, encoding: 'utf8', env: env as NodeJS.ProcessEnv,
    });
  }

  it('con MANCANTI_ESPORTA il file ha le migrazioni che il registro non ha, e apply.sh le salta', () => {
    const esporta = join(CARTELLA, 'mancanti.txt');
    const r = lanciaLoScript(NON_IN_PRODUZIONE, esporta);
    expect(r.status, `${r.stdout}${r.stderr}`).toBe(2);
    expect(existsSync(esporta), 'lo script non ha scritto l’elenco delle mancanti').toBe(true);
    expect(readFileSync(esporta, 'utf8')).toBe(NON_IN_PRODUZIONE.map((f) => `${f}\n`).join(''));

    // Il passaggio del flusso: l'elenco dello script va dritto ad apply.sh.
    const a = apply('mycity_dal_registro', { SALTA_MIGRAZIONI: esporta });
    expect(a.codice, a.uscita).toBe(0);
    expect(a.applicate).toEqual(MIGRAZIONI.filter((f) => !NON_IN_PRODUZIONE.includes(f)));
  });

  it('senza mancanti il file c’è ed è vuoto (apply.sh applica tutto)', () => {
    const esporta = join(CARTELLA, 'mancanti-nessuna.txt');
    const r = lanciaLoScript([], esporta);
    expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
    expect(readFileSync(esporta, 'utf8')).toBe('');
  });
});

describe('③ il flusso della deriva fa girare le prove dei permessi sul database come la produzione', () => {
  type Passo = { name?: string; id?: string; run?: string; env?: Record<string, string>; if?: string };
  const TESTO = readFileSync(join(RADICE, '.github/workflows/deriva-migrazioni-produzione.yml'), 'utf8');
  const passi = (yaml.load(TESTO) as { jobs: { deriva: { steps: Passo[] } } }).jobs.deriva.steps;
  const indice = (re: RegExp) => passi.findIndex((p) => re.test(p.run ?? ''));

  it('il passo dei nomi esporta l’elenco nella cartella temporanea del runner', () => {
    const nomi = passi.find((p) => /db:check-drift/.test(p.run ?? ''));
    expect(nomi?.env?.MANCANTI_ESPORTA).toBe('${{ runner.temp }}/mancanti.txt');
  });

  it('dopo, apply.sh ricostruisce mycity_come_produzione saltando quelle, solo verso il Postgres del giro', () => {
    const i = indice(/SALTA_MIGRAZIONI="\$RUNNER_TEMP\/mancanti\.txt" bash tests\/sql\/harness\/apply\.sh mycity_come_produzione/);
    expect(i, 'manca la ricostruzione come la produzione').toBeGreaterThan(indice(/db:check-drift/));
    const passo = passi[i];
    expect(passo.env?.PGHOST).toBe('localhost');
    expect(JSON.stringify(passo)).not.toMatch(/SUPABASE_DB_URL|secrets\./);
    expect(passo.run, 'senza elenco non deve ricostruire «tutti i file»').toMatch(/if \[ ! -f "\$RUNNER_TEMP\/mancanti\.txt" \]; then[\s\S]*exit 1/);
    expect(passo.if).toMatch(/!cancelled\(\)/);
  });

  it('e run.sh fa girare le prove dei permessi su quel database, e il lavoro diventa rosso se una cade', () => {
    const iApply = indice(/apply\.sh mycity_come_produzione/);
    const i = indice(/bash tests\/sql\/harness\/run\.sh mycity_come_produzione/);
    expect(i, 'le prove dei permessi non girano sul database come la produzione').toBeGreaterThan(iApply);
    const passo = passi[i];
    expect(passo.if).toContain(`steps.${passi[iApply].id}.outcome == 'success'`);
    expect(passo.env?.PGHOST).toBe('localhost');
    expect(JSON.stringify(passo)).not.toMatch(/SUPABASE_DB_URL|secrets\./);
    expect(passo.run).toMatch(/exit 1/);
  });
});
