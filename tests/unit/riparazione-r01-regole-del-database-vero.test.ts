import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * R01 — LE PROVE DEI PERMESSI IN SQL NON CERTIFICANO PIU' SOLO UN DATABASE RICOSTRUITO DAI FILE.
 *
 * Le prove di tests/sql/rls/ girano su un database che la CI ricostruisce applicando TUTTE le
 * migrazioni (tests/sql/harness/apply.sh). Il controllo notturno della deriva guardava solo i NOMI
 * delle migrazioni registrate in produzione: il 9 settembre 11 funzioni e 27 regole di accesso sono
 * tornate indietro con tutti i nomi al loro posto, e le prove restavano verdi. In più la CI le
 * faceva girare sulla 16, mentre la produzione è la 17.
 *
 * Qui si pretende:
 *  ① le prove dei permessi girano sulla versione della produzione (quella che la copia notturna
 *    dichiara in backup-db.yml, VERSIONE_ATTESA);
 *  ② il lavoro notturno ricostruisce il database dai file su un Postgres del giro, della stessa
 *    versione, senza mai dare a apply.sh (che cancella e ricrea) la stringa del database vero;
 *  ③ poi confronta davvero le regole dei due database: si fa girare il suo passo con un psql finto
 *    che risponde in un modo per la produzione e in un altro per i file, e il passo deve diventare
 *    rosso dicendo quale regola, restare verde solo se coincidono, e non passare se la produzione
 *    non risponde.
 */

const richiedi = createRequire(import.meta.url);
const yaml = richiedi('js-yaml') as { load: (t: string) => unknown };

type Passo = { name?: string; run?: string; env?: Record<string, string> };
type Lavoro = { services?: { postgres?: { image?: string } }; steps?: Passo[] };
type Flusso = { jobs: Record<string, Lavoro> };

const RADICE = process.cwd();
const leggi = (p: string) => yaml.load(readFileSync(join(RADICE, p), 'utf8')) as Flusso;

/** La versione della produzione, come la dichiara la copia notturna (pg_dump deve essere quella). */
function versioneDellaProduzione(): number {
  const testo = readFileSync(join(RADICE, '.github/workflows/backup-db.yml'), 'utf8');
  const versioni = [...new Set([...testo.matchAll(/VERSIONE_ATTESA:\s*"(\d+)"/g)].map((m) => Number(m[1])))];
  expect(versioni, 'backup-db.yml non dichiara una sola versione della produzione').toHaveLength(1);
  return versioni[0];
}

function versioneDelServizio(lavoro: Lavoro | undefined): number | null {
  const m = /^postgres:(\d+)/.exec(lavoro?.services?.postgres?.image ?? '');
  return m ? Number(m[1]) : null;
}

/** Il nome del database che un passo ricostruisce con apply.sh, se lo fa. */
function databaseRicostruito(passo: Passo): string | null {
  return /tests\/sql\/harness\/apply\.sh\s+([a-z_][a-z0-9_]*)/.exec(passo.run ?? '')?.[1] ?? null;
}

const DERIVA = '.github/workflows/deriva-migrazioni-produzione.yml';
const URL_FINTO_DEL_VERO = 'postgresql://finto:finto@produzione.invalid:5432/postgres';

function lavoroDellaDeriva(): { lavoro: Lavoro; passi: Passo[] } {
  const lavori = Object.values(leggi(DERIVA).jobs);
  const lavoro = lavori.find((l) => (l.steps ?? []).some((p) => p.name === 'Confronta il repository con il database vero'));
  expect(lavoro, 'nel flusso della deriva non trovo il lavoro che confronta i nomi').toBeTruthy();
  return { lavoro: lavoro as Lavoro, passi: (lavoro as Lavoro).steps ?? [] };
}

/** Il passo che ricostruisce dai file e quello, dopo, che legge il database vero e quello ricostruito. */
function passiDelConfronto() {
  const { lavoro, passi } = lavoroDellaDeriva();
  const iNomi = passi.findIndex((p) => p.name === 'Confronta il repository con il database vero');
  const iRicostruisce = passi.findIndex((p) => databaseRicostruito(p) !== null);
  expect(iRicostruisce, 'il lavoro notturno non ricostruisce il database dai file: confronta solo i nomi').toBeGreaterThan(-1);
  const db = databaseRicostruito(passi[iRicostruisce]) as string;
  const iConfronta = passi.findIndex(
    (p, i) =>
      i > iRicostruisce &&
      /secrets\.SUPABASE_DB_URL/.test(Object.values(p.env ?? {}).join(' ')) &&
      /\bpsql\b/.test(p.run ?? '') &&
      (p.run ?? '').concat(Object.values(p.env ?? {}).join(' ')).includes(db),
  );
  expect(iConfronta, 'nessun passo confronta il database vero con quello ricostruito dai file').toBeGreaterThan(-1);
  return { lavoro, iNomi, iRicostruisce, iConfronta, db, ricostruisce: passi[iRicostruisce], confronta: passi[iConfronta] };
}

const DAI_FILE = [
  'regola public.orders "Admins can read all orders" PERMISSIVE ruoli=public per=SELECT using=public.is_admin() check=-',
  'rls public.orders attiva=t forzata=f',
  'funzione public.is_admin() definer=t impronta=402ccb6dde0f0ac7bc8bbee51c475f41',
].join('\n');

/** Fa girare il passo del confronto con un psql finto: una risposta per la produzione, una per i file. */
function giraIlConfronto(passo: Passo, vero: string, opzioni: { veroCade?: boolean } = {}) {
  const cestino = mkdtempSync(join(tmpdir(), 'r01-regole-'));
  try {
    writeFileSync(join(cestino, 'vero.txt'), vero + '\n');
    writeFileSync(join(cestino, 'file.txt'), DAI_FILE + '\n');
    const psql = join(cestino, 'psql');
    writeFileSync(
      psql,
      `#!/usr/bin/env bash
dove=""; sql=""; prec=""
for a in "$@"; do
  case "$prec" in -f) sql="$a" ;; -d) dove="$a" ;; esac
  case "$a" in postgres://*|postgresql://*) dove="$a" ;; esac
  prec="$a"
done
n=$(ls "$FINTO_CARTELLA" | grep -c '^sql-' || true)
cp "$sql" "$FINTO_CARTELLA/sql-$n.sql"
printf '%s\\n' "$dove" >> "$FINTO_CARTELLA/chiamate.txt"
if [ "$dove" = "$SUPABASE_DB_URL" ]; then
  if [ -n "\${FINTO_VERO_CADE:-}" ]; then echo "psql: error: connection to server failed" >&2; exit 2; fi
  cat "$FINTO_CARTELLA/vero.txt"
else
  cat "$FINTO_CARTELLA/file.txt"
fi
`,
    );
    chmodSync(psql, 0o755);
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(passo.env ?? {})) env[k] = /\$\{\{/.test(String(v)) ? 'finto' : String(v);
    env.SUPABASE_DB_URL = URL_FINTO_DEL_VERO;
    const esito = spawnSync('bash', ['-e', '-c', passo.run ?? ''], {
      cwd: cestino,
      encoding: 'utf8',
      timeout: 20_000,
      env: {
        ...env,
        NODE_ENV: 'test',
        PATH: `${cestino}:${process.env.PATH ?? ''}`,
        RUNNER_TEMP: cestino,
        FINTO_CARTELLA: cestino,
        ...(opzioni.veroCade ? { FINTO_VERO_CADE: '1' } : {}),
      },
    });
    let chiamate: string[] = [];
    try {
      chiamate = readFileSync(join(cestino, 'chiamate.txt'), 'utf8').split('\n').filter(Boolean);
    } catch {
      chiamate = [];
    }
    const sql = readdirSync(cestino)
      .filter((f) => /^sql-\d+\.sql$/.test(f))
      .map((f) => readFileSync(join(cestino, f), 'utf8'));
    return { uscita: esito.status ?? -1, testo: `${esito.stdout}\n${esito.stderr}`, chiamate, sql };
  } finally {
    rmSync(cestino, { recursive: true, force: true });
  }
}

describe('le prove dei permessi in SQL valgono per il database vero', () => {
  it('le prove dei permessi girano sulla stessa versione di Postgres della produzione', () => {
    const produzione = versioneDellaProduzione();
    const ci = leggi('.github/workflows/ci.yml');
    const conLeProve = Object.entries(ci.jobs).filter(([, l]) =>
      (l.steps ?? []).some((p) => /tests\/sql\/harness\/run\.sh/.test(p.run ?? '')),
    );
    expect(conLeProve.length, 'nessun lavoro della CI fa girare le prove dei permessi in SQL').toBeGreaterThan(0);
    for (const [id, lavoro] of conLeProve) {
      expect(versioneDelServizio(lavoro), `«${id}» certifica i permessi su un Postgres diverso dalla produzione (${produzione})`).toBe(produzione);
    }
  });

  it('di notte il database si ricostruisce dai file, della versione della produzione, senza la stringa di quello vero', () => {
    const { lavoro, iNomi, iRicostruisce, iConfronta, ricostruisce } = passiDelConfronto();
    expect(versioneDelServizio(lavoro), 'il database ricostruito per il confronto non è della versione della produzione').toBe(
      versioneDellaProduzione(),
    );
    // apply.sh cancella e ricrea il database che gli si nomina: mai con il database vero a portata di mano.
    expect(JSON.stringify(ricostruisce.env ?? {})).not.toMatch(/secrets\./);
    expect(ricostruisce.env?.PGHOST, 'la ricostruzione non punta esplicitamente al Postgres del giro').toBe('localhost');
    // I nomi si guardano prima: con migrazioni mancanti le regole sarebbero diverse per forza.
    expect(iNomi).toBeGreaterThan(-1);
    expect(iNomi).toBeLessThan(iRicostruisce);
    expect(iRicostruisce).toBeLessThan(iConfronta);
  });

  it('regole uguali nei due database: il confronto è verde e interroga tutti e due con la stessa domanda', () => {
    const { confronta, db } = passiDelConfronto();
    const { uscita, testo, chiamate, sql } = giraIlConfronto(confronta, DAI_FILE);
    expect(uscita, testo).toBe(0);
    expect(chiamate, 'il passo non ha interrogato il database vero').toContain(URL_FINTO_DEL_VERO);
    expect(
      chiamate.some((c) => c !== URL_FINTO_DEL_VERO && c.includes(db)),
      `il passo non ha interrogato il database ricostruito dai file (${db})`,
    ).toBe(true);
    expect(sql.length).toBeGreaterThanOrEqual(2);
    expect(new Set(sql).size, 'i due database ricevono domande diverse: il confronto non vale').toBe(1);
  });

  it('una regola tornata indietro in produzione fa rosso e dice quale, com è di là e com è nei file', () => {
    const { confronta } = passiDelConfronto();
    const tornataIndietro = DAI_FILE.replace('using=public.is_admin()', 'using=true');
    const { uscita, testo } = giraIlConfronto(confronta, tornataIndietro);
    expect(uscita, 'una regola diversa in produzione lascia il confronto verde').not.toBe(0);
    expect(testo).toContain('"Admins can read all orders" PERMISSIVE ruoli=public per=SELECT using=true');
    expect(testo).toContain('"Admins can read all orders" PERMISSIVE ruoli=public per=SELECT using=public.is_admin()');
    expect(testo).toMatch(/::error::/);
  });

  it('anche una funzione riscritta o la RLS spenta fanno rosso', () => {
    const { confronta } = passiDelConfronto();
    for (const vero of [
      DAI_FILE.replace('impronta=402ccb6dde0f0ac7bc8bbee51c475f41', 'impronta=110347b79c9b3e6ded6e9ddf5fd8e881'),
      DAI_FILE.replace('attiva=t', 'attiva=f'),
      DAI_FILE + '\nesegue anon public._wallet_apply(uuid,integer,text,text)',
    ]) {
      const { uscita, testo } = giraIlConfronto(confronta, vero);
      expect(uscita, `differenza non vista:\n${testo}`).not.toBe(0);
    }
  });

  it('se la produzione non risponde il confronto non passa per verde', () => {
    const { confronta } = passiDelConfronto();
    const { uscita } = giraIlConfronto(confronta, DAI_FILE, { veroCade: true });
    expect(uscita).not.toBe(0);
  });

  it('la domanda guarda quello che decide i permessi: RLS, regole, funzioni, inneschi, e cosa possono anon e authenticated', () => {
    const { confronta } = passiDelConfronto();
    const [domanda] = giraIlConfronto(confronta, DAI_FILE).sql;
    expect(domanda, 'il passo non ha passato nessuna domanda a psql').toBeTruthy();
    for (const pezzo of ['relrowsecurity', 'pg_policies', 'pg_get_functiondef', 'pg_get_triggerdef', 'has_function_privilege', 'has_table_privilege', 'attacl']) {
      expect(domanda, `la domanda non guarda ${pezzo}`).toContain(pezzo);
    }
    expect(domanda).toMatch(/'anon',\s*'authenticated'/);
  });
});
