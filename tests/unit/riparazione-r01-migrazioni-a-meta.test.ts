import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { esegui, passo } from './_lavoro-di-rilascio';
import { avviaPostgresConIndirizzo, type PostgresConIndirizzo } from './riparazione-r01-pg';

/**
 * R01-014 — Il database avanti si scopriva solo se cadeva la prova di fumo, non se cadevano le
 * migrazioni. Qui il passo vero del rilascio gira contro un Postgres usa e getta, con tre
 * migrazioni di cui la seconda rotta: la prima resta applicata, e il riepilogo lo deve dire.
 */
describe('R01-014 · migrazioni cadute a meta\': il riepilogo dice che il database e\' avanti', () => {
  let pg: PostgresConIndirizzo;
  let scena: string;
  beforeAll(() => {
    pg = avviaPostgresConIndirizzo();
    scena = mkdtempSync(join(tmpdir(), 'r01-meta-'));
    const mig = join(scena, 'mig');
    mkdirSync(mig);
    writeFileSync(join(mig, '001_buona.sql'), 'CREATE TABLE public.buona (id int);\n');
    writeFileSync(join(mig, '002_rotta.sql'), 'SELECT * FROM tabella_che_non_esiste;\n');
    writeFileSync(join(mig, '003_dopo.sql'), 'CREATE TABLE public.dopo (id int);\n');
    const bin = join(scena, 'bin');
    mkdirSync(bin);
    // `sudo apt-get install postgresql-client`: qui psql c'e' gia'.
    writeFileSync(join(bin, 'sudo'), '#!/usr/bin/env bash\nexit 0\n');
    chmodSync(join(bin, 'sudo'), 0o755);
  });
  afterAll(() => { pg?.ferma(); rmSync(scena, { recursive: true, force: true }); });

  it('nomina la migrazione applicata prima del guasto e quella rotta', () => {
    const e = esegui(passo('Applica le migrazioni al database, prima di pubblicare'), {
      env: {
        PATH: `${join(scena, 'bin')}:${process.env.PATH}`,
        SUPABASE_DB_URL: pg.url,
        CARTELLA_MIGRAZIONI: join(scena, 'mig'),
      },
    });
    expect(e.uscita).not.toBe(0);
    expect(pg.psql("SELECT to_regclass('public.buona') IS NOT NULL")).toBe('t');
    expect(e.riepilogo).toMatch(/database e' avanti/);
    expect(e.riepilogo).toMatch(/001_buona\.sql/);
    expect(e.riepilogo).toMatch(/002_rotta\.sql/);
    expect(e.output.fermo).toBe('migrazioni-a-meta');
  });
});
