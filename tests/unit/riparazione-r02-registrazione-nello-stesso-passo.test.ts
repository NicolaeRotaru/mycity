/**
 * R02-004 — Lo script del rilascio applicava la migrazione e la registrava con due comandi psql
 * (due connessioni): se la registrazione cadeva, la migrazione restava applicata e non registrata,
 * e al rilascio dopo veniva riapplicata. Adesso e' un passo solo: se la registrazione cade, anche
 * l'applicazione torna indietro. Contro un PostgreSQL usa e getta su questa macchina, mai remoto.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { avviaPostgresConIndirizzo, type PostgresConIndirizzo } from './riparazione-r01-pg';

describe('R02-004 · applicazione e registrazione nello stesso passo', { timeout: 60_000 }, () => {
  let pg: PostgresConIndirizzo;
  let cartella: string;
  beforeAll(() => { pg = avviaPostgresConIndirizzo(); cartella = mkdtempSync(join(tmpdir(), 'mig-r02-')); });
  afterAll(() => { pg?.ferma(); if (cartella) rmSync(cartella, { recursive: true, force: true }); });

  it('se la registrazione non riesce, la migrazione non resta applicata a meta\'', () => {
    // La migrazione crea una tabella e poi chiude la porta alla propria registrazione.
    writeFileSync(join(cartella, '406_y.sql'),
      "CREATE TABLE public.y (id int);\n" +
      "ALTER TABLE supabase_migrations.schema_migrations ADD CONSTRAINT no_406 CHECK (version <> '406');\n");
    const r = spawnSync('bash', [join(process.cwd(), 'scripts/applica-migrazioni-mancanti.sh')], {
      env: { ...process.env, SUPABASE_DB_URL: pg.url, CARTELLA_MIGRAZIONI: cartella, MASSIMO_MIGRAZIONI: '' },
      encoding: 'utf8',
    });
    expect(r.status).not.toBe(0);
    expect(pg.psql("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '406'")).toBe('0');
    expect(pg.psql("SELECT to_regclass('public.y') IS NULL")).toBe('t');
  });
});
