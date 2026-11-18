import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { esegui, passo } from './_lavoro-di-rilascio';
import { avviaPostgresConIndirizzo, type PostgresConIndirizzo } from './riparazione-r01-pg';

/**
 * R07-002 — Se lo script delle migrazioni cade FRA un file e il successivo (il controllo del registro
 * per il file dopo, scripts/applica-migrazioni-mancanti.sh, gira dopo l'INSERT di registrazione), il
 * riepilogo del rilascio prendeva l'ultima riga «▶ applico» e la chiamava «quella che si e' rotta»:
 * accusava una migrazione sana, gia' applicata e registrata, e la toglieva dall'elenco delle applicate.
 *
 * Qui il passo vero del rilascio gira contro un Postgres usa e getta. Un psql finto davanti a quello
 * vero fa cadere la connessione al secondo controllo del file 002: cioe' dopo che la 001 e' stata
 * applicata e registrata, prima che la 002 cominci.
 */
const PASSO = 'Applica le migrazioni al database, prima di pubblicare';

describe('R07-002 · lo script cade fra due file: il riepilogo non accusa la migrazione sana', () => {
  let pg: PostgresConIndirizzo;
  let scena: string;
  beforeAll(() => {
    pg = avviaPostgresConIndirizzo();
    scena = mkdtempSync(join(tmpdir(), 'r07-fra-due-'));
    for (const cartella of ['sana', 'rotta', 'bin', 'bin-rotta']) mkdirSync(join(scena, cartella));
    writeFileSync(join(scena, 'sana', '001_buona.sql'), 'CREATE TABLE public.buona (id int);\n');
    writeFileSync(join(scena, 'sana', '002_dopo.sql'), 'CREATE TABLE public.dopo (id int);\n');
    writeFileSync(join(scena, 'rotta', '001_buona.sql'), 'CREATE TABLE public.buona (id int);\n');
    writeFileSync(join(scena, 'rotta', '002_rotta.sql'), 'SELECT * FROM tabella_che_non_esiste;\n');
    const psqlVero = spawnSync('bash', ['-c', 'command -v psql'], { encoding: 'utf8' }).stdout.trim();
    expect(psqlVero).toBeTruthy();
    // `sudo apt-get install postgresql-client`: qui psql c'e' gia'.
    for (const bin of ['bin', 'bin-rotta']) {
      writeFileSync(join(scena, bin, 'sudo'), '#!/usr/bin/env bash\nexit 0\n');
      chmodSync(join(scena, bin, 'sudo'), 0o755);
    }
    // Il primo controllo della 002 e' quello del giro che conta; il secondo e' quello che lo script
    // rifa' subito prima di applicarla, dopo aver registrato la 001. Li' cade la connessione.
    writeFileSync(
      join(scena, 'bin', 'psql'),
      [
        '#!/usr/bin/env bash',
        `CONTA="${join(scena, 'conta')}"`,
        'if printf "%s " "$@" | grep -q "version = \'002\'"; then',
        '  n=$(( $(cat "$CONTA" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$CONTA"',
        '  if [ "$n" -ge 2 ]; then',
        '    echo "psql: error: connection to server failed: server closed the connection unexpectedly" >&2',
        '    exit 2',
        '  fi',
        'fi',
        `exec "${psqlVero}" "$@"`,
        '',
      ].join('\n'),
    );
    chmodSync(join(scena, 'bin', 'psql'), 0o755);
  });
  afterAll(() => {
    pg?.ferma();
    rmSync(scena, { recursive: true, force: true });
  });

  it('la 001 applicata e registrata non viene chiamata «quella che si e\' rotta»', () => {
    const e = esegui(passo(PASSO), {
      env: {
        PATH: `${join(scena, 'bin')}:${process.env.PATH}`,
        SUPABASE_DB_URL: pg.url,
        CARTELLA_MIGRAZIONI: join(scena, 'sana'),
      },
    });
    expect(e.uscita).toBe(2);
    // La scena e' quella della voce: la 001 c'e' ed e' registrata, la 002 non e' mai cominciata.
    expect(pg.psql("SELECT to_regclass('public.buona') IS NOT NULL")).toBe('t');
    expect(pg.psql("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '001'")).toBe('1');
    expect(pg.psql("SELECT to_regclass('public.dopo') IS NULL")).toBe('t');

    expect(e.output.fermo).toBe('migrazioni-a-meta');
    expect(e.riepilogo).toMatch(/database e' avanti/);
    expect(e.riepilogo).not.toMatch(/Quella che si e' rotta: `001_buona\.sql`/);
    expect(e.riepilogo).not.toMatch(/correggi la migrazione rotta/);
    expect(e.riepilogo).toMatch(/L'ultima cominciata: `001_buona\.sql`\. Il suo SQL non ha dato errori/);
    expect(e.riepilogo).toMatch(/puo' essere gia' applicata, e anche registrata/);
  });

  it('una migrazione col suo SQL rotto si chiama ancora «quella che si e\' rotta»', () => {
    const e = esegui(passo(PASSO), {
      env: {
        PATH: `${join(scena, 'bin-rotta')}:${process.env.PATH}`,
        SUPABASE_DB_URL: pg.url,
        CARTELLA_MIGRAZIONI: join(scena, 'rotta'),
      },
    });
    expect(e.uscita).toBe(3);
    expect(e.riepilogo).toMatch(/Quella che si e' rotta: `002_rotta\.sql`/);
    expect(e.riepilogo).toMatch(/correggi la migrazione rotta/);
    expect(e.riepilogo).not.toMatch(/L'ultima cominciata/);
  });
});
