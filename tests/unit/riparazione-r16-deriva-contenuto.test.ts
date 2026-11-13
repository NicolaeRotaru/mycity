/**
 * R16-003 — Il controllo della deriva delle migrazioni confrontava solo numeri e nomi: l'impronta
 * md5 di ogni file si calcolava e si stampava, ma non entrava in nessun confronto. Una migrazione
 * modificata dopo essere stata applicata passava verde.
 *
 * Adesso lo script del rilascio scrive l'impronta del file nel registro (`statements`, come
 * commento SQL «-- md5:<impronta>») e il controllo la confronta con il file di oggi. Qui:
 * ① la funzione pura `esitoDelConfronto` con righe del registro scritte a mano;
 * ② lo script vero contro un PostgreSQL usa e getta su questa macchina (mai un indirizzo
 *    remoto): applica una migrazione, poi il file cambia, e il controllo se ne accorge.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { esitoDelConfronto, USCITA } from '../../scripts/check-migration-drift.mjs';
import { avviaPostgresConIndirizzo, type PostgresConIndirizzo } from './riparazione-r01-pg';

const ROOT = process.cwd();
const md5 = (testo: string | Buffer) => createHash('md5').update(testo).digest('hex');
const VECCHIA = md5('CREATE TABLE public.x (id int);\n');
const NUOVA = md5('CREATE TABLE public.x (id int, nota text);\n');

describe('R16-003 · il confronto del contenuto (funzione pura)', () => {
  const repo = [{ prefix: '405', name: 'x', file: '405_x.sql', impronta: NUOVA }];

  it('una migrazione cambiata dopo essere stata applicata è deriva, e lo dice', () => {
    const esito = esitoDelConfronto(repo, [{ version: '405', name: 'x', statements: [`-- md5:${VECCHIA}`] }]);
    expect(esito.codice).toBe(USCITA.DERIVA);
    expect(esito.righe.join('\n')).toContain('405_x.sql');
    expect(esito.righe.join('\n')).toMatch(/modificat/);
  });

  it('con la stessa impronta è allineata', () => {
    const esito = esitoDelConfronto(repo, [{ version: '405', name: 'x', statements: [`-- md5:${NUOVA}`] }]);
    expect(esito.codice).toBe(USCITA.ALLINEATO);
  });

  it('una riga registrata senza impronta non si può confrontare: è allineata, e il verdetto non promette di più', () => {
    const esito = esitoDelConfronto(repo, [{ version: '405', name: 'x', statements: null }]);
    expect(esito.codice).toBe(USCITA.ALLINEATO);
    expect(esito.righe.join('\n')).toContain('Contenuto confrontato per 0 su 1');
  });
});

describe('R16-003 · lo script del rilascio registra l\'impronta, il controllo la confronta', { timeout: 60_000 }, () => {
  let pg: PostgresConIndirizzo;
  let cartella: string;
  beforeAll(() => { pg = avviaPostgresConIndirizzo(); cartella = mkdtempSync(join(tmpdir(), 'mig-r16-')); });
  afterAll(() => { pg?.ferma(); if (cartella) rmSync(cartella, { recursive: true, force: true }); });

  const registro = () =>
    pg
      .psql("SELECT json_agg(json_build_object('version', version, 'name', name, 'statements', statements)) FROM supabase_migrations.schema_migrations")
      .trim();
  const nelDeposito = () => {
    const file = '405_x.sql';
    return [{ prefix: '405', name: 'x', file, impronta: md5(readFileSync(join(cartella, file))) }];
  };

  it('applicata e poi cambiata: prima allineata, poi deriva', () => {
    writeFileSync(join(cartella, '405_x.sql'), 'CREATE TABLE public.x (id int);\n');
    const r = spawnSync('bash', [join(ROOT, 'scripts/applica-migrazioni-mancanti.sh')], {
      env: { ...process.env, SUPABASE_DB_URL: pg.url, CARTELLA_MIGRAZIONI: cartella, MASSIMO_MIGRAZIONI: '' },
      encoding: 'utf8',
    });
    expect(r.status, r.stderr).toBe(0);
    const righe = JSON.parse(registro());
    expect(righe).toHaveLength(1);

    const allineata = esitoDelConfronto(nelDeposito(), righe);
    expect(allineata.codice, allineata.righe.join('\n')).toBe(USCITA.ALLINEATO);
    expect(allineata.righe.join('\n')).toContain('Contenuto confrontato per tutte');

    // Qualcuno corregge la migrazione già applicata invece di scriverne una nuova.
    writeFileSync(join(cartella, '405_x.sql'), 'CREATE TABLE public.x (id int, nota text);\n');
    const cambiata = esitoDelConfronto(nelDeposito(), righe);
    expect(cambiata.codice, 'una migrazione cambiata dopo l\'applicazione passa verde').toBe(USCITA.DERIVA);
  });
});
