import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { avviaPostgresConIndirizzo, BIN_POSTGRES, type PostgresConIndirizzo } from './riparazione-r01-pg';

/**
 * R01-022 — L'avviso sul COMMIT dentro una migrazione usciva solo sullo standard error, e il
 * rilascio fa `bash scripts/applica-migrazioni-mancanti.sh | tee "$DIARIO"`: tiene solo lo
 * standard output. Nel riepilogo del rilascio l'avviso non arrivava mai.
 */
const ROOT = process.cwd();

describe.skipIf(!BIN_POSTGRES)('R01-022 · l\'avviso esce dalla porta che il rilascio legge', () => {
  let pg: PostgresConIndirizzo;
  let cartella: string;
  beforeAll(() => {
    pg = avviaPostgresConIndirizzo();
    cartella = mkdtempSync(join(tmpdir(), 'mig-r01w-'));
    writeFileSync(join(cartella, '001_con_commit.sql'), "BEGIN;\nCREATE TABLE public.a (id int);\nCOMMIT;\nNOTIFY pgrst, 'reload schema';\n");
  });
  afterAll(() => { pg?.ferma(); rmSync(cartella, { recursive: true, force: true }); });

  it('lo standard output porta l\'avviso come ::warning::', () => {
    const r = spawnSync('bash', [join(ROOT, 'scripts/applica-migrazioni-mancanti.sh')], {
      env: { ...process.env, SUPABASE_DB_URL: pg.url, CARTELLA_MIGRAZIONI: cartella, MASSIMO_MIGRAZIONI: '' },
      encoding: 'utf8',
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^::warning::.*001_con_commit\.sql/m);
  });
});

describe('R01-022 · il rilascio copia gli avvisi nel riepilogo, anche quando si ferma', () => {
  it('il passo delle migrazioni scrive le righe ::warning:: del diario nel riepilogo prima di uscire', () => {
    const yml = readFileSync(join(ROOT, '.github/workflows/deploy-dopo-ci.yml'), 'utf8');
    const copia = yml.indexOf(`grep '^::warning::' "$DIARIO"`);
    const uscita = yml.indexOf('if [ "$USCITA" != "0" ]; then exit "$USCITA"; fi');
    expect(copia).toBeGreaterThan(0);
    expect(copia).toBeLessThan(uscita);
    expect(yml.slice(copia - 200, uscita)).toMatch(/GITHUB_STEP_SUMMARY/);
  });
});
