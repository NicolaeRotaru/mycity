import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { esitoDelConfronto } from '../../scripts/check-migration-drift.mjs';
import { avviaPostgresConIndirizzo, BIN_POSTGRES, type PostgresConIndirizzo } from './riparazione-r01-pg';

/**
 * R01-024 — UNA MIGRAZIONE NUOVA CON LO STESSO NOME DI UNA VECCHIA NON ARRIVAVA MAI IN PRODUZIONE.
 *
 * Lo script del rilascio, il controllo della deriva e il conto delle mancanti chiedevano al
 * registro «numero OPPURE nome». Una 250_minori.sql dopo una 127_minori.sql trovava la riga della
 * vecchia: saltata per sempre, e tutti e tre i controlli verdi.
 */
const ROOT = process.cwd();

describe('R01-024 · il controllo della deriva non scambia un omonimo per la stessa migrazione', () => {
  it('una migrazione nuova con il nome di una vecchia risulta mancante', () => {
    const esito = esitoDelConfronto(
      [
        { prefix: '127', name: 'minori', file: '127_minori.sql' },
        { prefix: '250', name: 'minori', file: '250_minori.sql' },
      ],
      [{ version: '127', name: 'minori' }],
    );
    expect(esito.mancanti.join(' ')).toMatch(/250/);
    expect(esito.codice).not.toBe(0);
  });

  it('una rinumerazione vera (numero vecchio che non e\' piu\' un file) resta riconosciuta per nome', () => {
    const esito = esitoDelConfronto(
      [{ prefix: '108b', name: 'cosa', file: '108b_cosa.sql' }],
      [{ version: '9999', name: 'cosa' }],
    );
    expect(esito.codice).toBe(0);
  });

  it('nella cartella delle migrazioni non ci sono due nomi uguali', () => {
    const nomi = readdirSync(join(ROOT, 'migrations')).filter((f) => f.endsWith('.sql')).map((f) => f.replace(/^[^_]+_/, ''));
    const doppi = nomi.filter((n, i) => nomi.indexOf(n) !== i);
    expect(doppi).toEqual([]);
  });
});

describe.skipIf(!BIN_POSTGRES)('R01-024 · lo script del rilascio applica l\'omonimo nuovo', () => {
  let pg: PostgresConIndirizzo;
  let cartella: string;
  beforeAll(() => { pg = avviaPostgresConIndirizzo(); cartella = mkdtempSync(join(tmpdir(), 'mig-r01-')); });
  afterAll(() => { pg?.ferma(); rmSync(cartella, { recursive: true, force: true }); });

  const lancia = () =>
    spawnSync('bash', [join(ROOT, 'scripts/applica-migrazioni-mancanti.sh')], {
      env: { ...process.env, SUPABASE_DB_URL: pg.url, CARTELLA_MIGRAZIONI: cartella, MASSIMO_MIGRAZIONI: '' },
      encoding: 'utf8',
    });

  it('dopo 127_minori, la 250_minori si applica davvero', () => {
    writeFileSync(join(cartella, '127_minori.sql'), 'CREATE TABLE public.vecchia (id int);\n');
    const primo = lancia();
    expect(primo.status, primo.stderr).toBe(0);
    writeFileSync(join(cartella, '250_minori.sql'), 'CREATE TABLE public.nuova (id int);\n');
    const secondo = lancia();
    expect(secondo.status, secondo.stderr).toBe(0);
    expect(pg.psql("SELECT to_regclass('public.nuova') IS NOT NULL")).toBe('t');
    expect(pg.psql("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '250'")).toBe('1');
  });
});

