import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

// Come in _condizioni-github.ts: js-yaml c'è (dipendenza di altri pacchetti) ma senza i suoi tipi.
const yaml = createRequire(import.meta.url)('js-yaml') as { load: (testo: string) => unknown };

/**
 * Le prove dei permessi in SQL certificavano un database ricostruito dai file, non quello vero.
 *
 * ① Il lavoro rls-locale della CI girava su Postgres 16, la produzione su 17.
 * ② Il controllo notturno della deriva confrontava solo i NOMI delle migrazioni: una regola di accesso
 *    tornata indietro con lo stesso nome (il 9/9) restava invisibile. Adesso confronta l'impronta delle
 *    regole fra il database ricostruito (su Postgres 17) e quello vero, viste comprese.
 * ③ Il log del deposito è pubblico: del database vero escono solo i CONTI per tipo, mai righe, nomi,
 *    espressioni o definizioni; il database vero si legge in sola lettura, con il segreto di sempre.
 *
 * Il passo vero del confronto gira qui con un `psql` finto: nessuna rete, nessun database.
 */

const RADICE = process.cwd();
type Passo = { name?: string; run?: string; env?: Record<string, string>; if?: string };
type Lavoro = { services?: Record<string, { image?: string }>; steps: Passo[] };
const leggi = (f: string) => readFileSync(join(RADICE, f), 'utf8');
const CI = yaml.load(leggi('.github/workflows/ci.yml')) as { jobs: Record<string, Lavoro> };
const TESTO_DERIVA = leggi('.github/workflows/deriva-migrazioni-produzione.yml');
const DERIVA = yaml.load(TESTO_DERIVA) as { jobs: Record<string, Lavoro> };
const lavoro = DERIVA.jobs.deriva;
const confronto = lavoro.steps.find((s) => /regole del database vero/i.test(s.name ?? ''));

function sqlDelConfronto(): string {
  const m = (confronto?.run ?? '').match(/<<'FINE_SQL'\n([\s\S]*?)\nFINE_SQL/);
  if (!m) throw new Error('Nel passo del confronto non trovo la domanda SQL (heredoc FINE_SQL)');
  return m[1];
}

describe('① le prove dei permessi girano sulla versione della produzione', () => {
  it('rls-locale usa postgres:17', () => {
    expect(CI.jobs['rls-locale']?.services?.postgres?.image).toBe('postgres:17');
  });
});

describe('② la deriva confronta le regole, non solo i nomi', () => {
  it('il database ricostruito dai file sta su un postgres:17 del giro, e apply.sh non vede il database vero', () => {
    expect(lavoro.services?.postgres?.image).toBe('postgres:17');
    const ricostruisci = lavoro.steps.find((s) => /tests\/sql\/harness\/apply\.sh/.test(s.run ?? ''));
    expect(ricostruisci, 'manca la ricostruzione dai file').toBeTruthy();
    expect(ricostruisci?.env?.PGHOST).toBe('localhost');
    expect(JSON.stringify(ricostruisci)).not.toMatch(/SUPABASE_DB_URL/);
  });

  it('l impronta guarda RLS, regole, funzioni, permessi, inneschi e le viste (definizione e opzioni)', () => {
    const sql = sqlDelConfronto();
    for (const pezzo of ['relrowsecurity', 'pg_policies', 'pg_get_functiondef', 'has_function_privilege', 'has_table_privilege', 'aclexplode', 'pg_get_triggerdef', 'pg_get_viewdef', 'reloptions']) {
      expect(sql, `l impronta non guarda ${pezzo}`).toContain(pezzo);
    }
    expect(sql).toMatch(/'vista'/);
  });

  it('il database vero si legge in sola lettura: una transazione READ ONLY, solo SELECT', () => {
    const sql = sqlDelConfronto().replace(/--[^\n]*/g, '');
    const istruzioni = sql.split(';').map((x) => x.trim()).filter(Boolean);
    expect(istruzioni[0]).toMatch(/^BEGIN TRANSACTION READ ONLY$/i);
    expect(istruzioni[istruzioni.length - 1]).toMatch(/^ROLLBACK$/i);
    for (const i of istruzioni.slice(1, -1)) expect(i, `istruzione non di sola lettura: ${i.slice(0, 60)}`).toMatch(/^(SET LOCAL search_path = pg_catalog|WITH\b[\s\S]*\bSELECT\b|SELECT\b)/i);
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|GRANT|REVOKE|TRUNCATE|COPY|COMMENT|CALL|LOCK|VACUUM|REFRESH|EXECUTE)\b(?!')/);
  });

  it('dal database vero escono solo impronte md5: nomi e contenuti non lasciano il database', () => {
    expect(sqlDelConfronto()).toMatch(/SELECT tipo \|\| '\|' \|\| md5\(chiave\) \|\| '\|' \|\| md5\(contenuto\) FROM oggetti/);
  });

  it('usa solo il segreto che il flusso aveva già, e mai set -x', () => {
    const segreti = new Set([...TESTO_DERIVA.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]));
    expect([...segreti]).toEqual(['SUPABASE_DB_URL']);
    expect(confronto?.run).not.toMatch(/set -[a-z]*x|\bcomm\b|\bdiff\b|cat "\$cartella\/(vero|file)/);
  });
});

describe('③ il passo vero, con un psql finto: solo i conti per tipo', () => {
  let cestino = '';
  const h = (s: string) => s.repeat(32).slice(0, 32);
  // Impronte finte, riconoscibili: se una finisse nel log la prova la troverebbe.
  const UGUALI = [`rls|${h('a1')}|${h('b1')}`, `regola|${h('a2')}|${h('b2')}`, `vista|${h('a3')}|${h('b3')}`, `funzione|${h('a4')}|${h('b4')}`];

  beforeAll(() => {
    cestino = mkdtempSync(join(tmpdir(), 'r11-psql-finto-'));
    writeFileSync(
      join(cestino, 'psql'),
      [
        '#!/usr/bin/env bash',
        'if [ "$1" = "$SUPABASE_DB_URL" ]; then',
        '  if [ -n "$FINTO_VERO_ERRORE" ]; then echo "$FINTO_VERO_ERRORE" >&2; exit 2; fi',
        '  printf "%s" "$FINTO_VERO"',
        'else',
        '  printf "%s" "$FINTO_FILE"',
        'fi',
        '',
      ].join('\n'),
    );
    chmodSync(join(cestino, 'psql'), 0o755);
  });
  afterAll(() => rmSync(cestino, { recursive: true, force: true }));

  function gira(vero: string[], file: string[], extra: Record<string, string> = {}) {
    if (!confronto?.run) throw new Error('Il passo del confronto delle regole non ha uno script');
    const esito = spawnSync('bash', ['-e', '-c', confronto.run], {
      encoding: 'utf8',
      env: {
        NODE_ENV: 'test',
        PATH: `${cestino}:${process.env.PATH}`,
        SUPABASE_DB_URL: 'postgresql://postgres.rifsegreto:pw@pooler.esempio:5432/postgres',
        DB_DAI_FILE: 'postgresql://postgres:postgres@localhost:5432/mycity_dai_file',
        FINTO_VERO: vero.map((r) => `${r}\n`).join(''),
        FINTO_FILE: file.map((r) => `${r}\n`).join(''),
        ...extra,
      },
    });
    return { codice: esito.status, testo: `${esito.stdout}${esito.stderr}` };
  }

  it('uguali: verde, coi conti a zero', () => {
    const { codice, testo } = gira(UGUALI, UGUALI);
    expect(codice).toBe(0);
    expect(testo).toContain('nessuna differenza');
    expect(testo).toMatch(/regola: 0 diversi · 0 mancano · 0 in più/);
  });

  it('una regola cambiata, una vista che manca e una funzione in più: rosso, e solo i conti', () => {
    const vero = [UGUALI[0], `regola|${h('a2')}|${h('c9')}`, UGUALI[3], `funzione|${h('d7')}|${h('e7')}`, 'regola public.ordini qual=(auth.uid() = user_id)'];
    const { codice, testo } = gira(vero, UGUALI);
    expect(codice).toBe(1);
    expect(testo).toMatch(/regola: 1 diversi · 0 mancano · 0 in più/);
    expect(testo).toMatch(/vista: 0 diversi · 1 mancano · 0 in più/);
    expect(testo).toMatch(/funzione: 0 diversi · 0 mancano · 1 in più/);
    expect(testo).toMatch(/3 oggetti diversi/);
    // Nessuna riga, nessuna impronta, nessun testo del database vero nel log.
    for (const pezzo of [h('a2'), h('c9'), h('a3'), h('d7'), 'auth.uid()', 'public.ordini']) expect(testo).not.toContain(pezzo);
  });

  it('il database vero che non risponde: rosso, e il motivo di psql (indirizzo, utente) non si stampa', () => {
    const { codice, testo } = gira(UGUALI, UGUALI, {
      FINTO_VERO_ERRORE: 'psql: error: connection to server at "pooler.esempio" failed: FATAL: password authentication failed for user "postgres.rifsegreto"',
    });
    expect(codice).toBe(1);
    expect(testo).toMatch(/NON è partito/);
    expect(testo).not.toContain('rifsegreto');
    expect(testo).not.toContain('pooler.esempio');
  });

  it('un lato senza oggetti: il confronto non vale, rosso', () => {
    const { codice, testo } = gira([], UGUALI);
    expect(codice).toBe(1);
    expect(testo).toMatch(/NON vale/);
  });
});
