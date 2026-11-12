import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { avviaPostgresConIndirizzo, BIN_POSTGRES, type PostgresConIndirizzo } from './riparazione-r01-pg';

/**
 * R01-023 — Lo script prometteva che il danno di un COMMIT dentro una migrazione era nullo
 * («dopo resta solo NOTIFY»), e lo diceva uguale per tutti i file con un COMMIT. Non era vero per
 * la 115 e la 117, che dopo il COMMIT fanno altro lavoro. Adesso l'avviso distingue i due casi.
 */
const ROOT = process.cwd();

describe.skipIf(!BIN_POSTGRES)('R01-023 · l\'avviso sul COMMIT dice quando il danno non e\' nullo', () => {
  let pg: PostgresConIndirizzo;
  let cartella: string;
  beforeAll(() => {
    pg = avviaPostgresConIndirizzo();
    cartella = mkdtempSync(join(tmpdir(), 'mig-r01c-'));
    writeFileSync(join(cartella, '001_solo_notify.sql'),
      "BEGIN;\nCREATE TABLE public.a (id int);\nCOMMIT;\n-- ricarica\nNOTIFY pgrst, 'reload schema';\n");
    writeFileSync(join(cartella, '002_lavoro_dopo.sql'),
      "BEGIN;\nCREATE TABLE public.b (id int);\nCOMMIT;\n\nBEGIN;\nALTER TABLE public.b ADD COLUMN x int;\nCOMMIT;\n");
  });
  afterAll(() => { pg?.ferma(); rmSync(cartella, { recursive: true, force: true }); });

  it('avvisa forte solo il file che fa lavoro dopo il proprio COMMIT', () => {
    const r = spawnSync('bash', [join(ROOT, 'scripts/applica-migrazioni-mancanti.sh')], {
      env: { ...process.env, SUPABASE_DB_URL: pg.url, CARTELLA_MIGRAZIONI: cartella, MASSIMO_MIGRAZIONI: '' },
      encoding: 'utf8',
    });
    expect(r.status, r.stderr).toBe(0);
    const tutto = `${r.stdout}\n${r.stderr}`;
    const forte = tutto.split('\n').filter((l) => /⚠⚠/.test(l));
    expect(forte.join('\n')).toMatch(/002_lavoro_dopo\.sql/);
    expect(forte.join('\n')).not.toMatch(/001_solo_notify/);
    expect(tutto).not.toMatch(/002_lavoro_dopo\.sql[^\n]*resta solo NOTIFY/);
  });
});
