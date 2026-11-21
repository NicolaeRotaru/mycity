/**
 * R02-007 (21/11/2026) — Applicazione e registrazione stavano gia' nello stesso psql, ma la
 * registrazione (-c) veniva DOPO il file (-f). Una migrazione chiusa nel suo BEGIN; … COMMIT;
 * (41 su 210 nel deposito) chiude con quel COMMIT anche la transazione dello script: la
 * registrazione restava una transazione a parte e, se cadeva, la migrazione restava applicata e
 * non registrata (al rilascio dopo si riapplicava). Adesso la registrazione viene PRIMA del file,
 * dentro la stessa transazione fino al primo COMMIT del file. Contro un PostgreSQL usa e getta su
 * questa macchina, mai remoto.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { avviaPostgresConIndirizzo, type PostgresConIndirizzo } from './riparazione-r01-pg';

describe('R02-007 · la registrazione regge anche con il COMMIT proprio della migrazione', { timeout: 60_000 }, () => {
  let pg: PostgresConIndirizzo;
  let cartella: string;
  beforeAll(() => { pg = avviaPostgresConIndirizzo(); cartella = mkdtempSync(join(tmpdir(), 'mig-r02c-')); });
  afterAll(() => { pg?.ferma(); if (cartella) rmSync(cartella, { recursive: true, force: true }); });

  it('una migrazione chiusa in BEGIN; … COMMIT; la cui registrazione cade non resta applicata', () => {
    // La migrazione, nella sua transazione, crea una tabella e chiude la porta alla propria
    // registrazione; poi il suo COMMIT.
    writeFileSync(join(cartella, '407_z.sql'),
      'BEGIN;\n' +
      'CREATE TABLE public.z (id int);\n' +
      "ALTER TABLE supabase_migrations.schema_migrations ADD CONSTRAINT no_407 CHECK (version <> '407');\n" +
      'COMMIT;\n');
    const r = spawnSync('bash', [join(process.cwd(), 'scripts/applica-migrazioni-mancanti.sh')], {
      env: { ...process.env, SUPABASE_DB_URL: pg.url, CARTELLA_MIGRAZIONI: cartella, MASSIMO_MIGRAZIONI: '' },
      encoding: 'utf8',
    });
    expect(r.status, 'lo script deve fermarsi: la migrazione non si puo\' registrare').not.toBe(0);
    expect(pg.psql("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '407'")).toBe('0');
    expect(
      pg.psql("SELECT to_regclass('public.z') IS NULL"),
      'la tabella della migrazione non registrata e\' rimasta: applicata e non registrata',
    ).toBe('t');
  });
});
