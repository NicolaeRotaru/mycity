import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * R30-022 — Il controllo di deriva confronta anche i permessi, non solo i nomi.
 *
 * Sul sito vero anon non legge public.profiles; sul database ricostruito dalle migrazioni sì,
 * e scripts/check-migration-drift.mjs guardava solo i nomi delle migrazioni: la differenza
 * restava invisibile. Ora, con PERMESSI_ATTESI=<file>, i permessi di anon e authenticated del
 * database collegato si confrontano con un elenco fornito; con PERMESSI_ESPORTA=<file> si scrivono.
 *
 * Qui lo script vero gira in una cartella a parte con un `pg` finto: nessun database, nessuna rete.
 * Il `pg` finto risponde al registro delle migrazioni con i file della cartella, e a ogni altra
 * domanda con i permessi scritti in FINTI_PERMESSI.
 */

const SCRIPT = readFileSync(join(process.cwd(), 'scripts', 'check-migration-drift.mjs'), 'utf8');

const PG_FINTO = `
const fs = require('node:fs');
class Client {
  constructor() {}
  async connect() {}
  async end() {}
  async query(sql) {
    if (/schema_migrations/.test(sql)) {
      const righe = fs.readdirSync('migrations').map((f) => {
        const m = f.match(/^(\\d{3}[a-z]?)_([a-z0-9_]+)\\.sql$/);
        return { version: m[1], name: m[2], statements: null };
      });
      return { rows: righe };
    }
    return { rows: JSON.parse(fs.readFileSync(process.env.FINTI_PERMESSI, 'utf8')) };
  }
}
module.exports = { Client };
`;

const cartelle: string[] = [];
afterAll(() => {
  for (const c of cartelle) rmSync(c, { recursive: true, force: true });
});

type Riga = { tipo: string; oggetto: string; ruolo: string; permesso: string };

/** Il sito vero, come lo descrive la voce: anon non legge profiles, authenticated sì. */
const PRODUZIONE: Riga[] = [
  { tipo: 'schema', oggetto: 'public', ruolo: 'anon', permesso: 'USAGE' },
  { tipo: 'schema', oggetto: 'public', ruolo: 'authenticated', permesso: 'USAGE' },
  { tipo: 'tabella', oggetto: 'products', ruolo: 'anon', permesso: 'SELECT' },
  { tipo: 'tabella', oggetto: 'profiles', ruolo: 'authenticated', permesso: 'SELECT' },
  { tipo: 'funzione', oggetto: 'negozio_approvato(uuid)', ruolo: 'anon', permesso: 'EXECUTE' },
  { tipo: 'colonna', oggetto: 'conversations.buyer_unread_count', ruolo: 'authenticated', permesso: 'UPDATE' },
];
const RICOSTRUITO_APERTO: Riga[] = [...PRODUZIONE, { tipo: 'tabella', oggetto: 'profiles', ruolo: 'anon', permesso: 'SELECT' }];

/** Lo script vero in una cartella sua, col `pg` finto e due migrazioni finte già «applicate». */
function lancia(permessiDelDatabase: Riga[], env: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'r30-deriva-permessi-'));
  cartelle.push(dir);
  mkdirSync(join(dir, 'migrations'));
  writeFileSync(join(dir, 'migrations', '001_prima.sql'), 'select 1;\n');
  writeFileSync(join(dir, 'migrations', '002_seconda.sql'), 'select 2;\n');
  mkdirSync(join(dir, 'node_modules', 'pg'), { recursive: true });
  writeFileSync(join(dir, 'node_modules', 'pg', 'package.json'), JSON.stringify({ name: 'pg', main: 'index.js' }));
  writeFileSync(join(dir, 'node_modules', 'pg', 'index.js'), PG_FINTO);
  writeFileSync(join(dir, 'check-migration-drift.mjs'), SCRIPT);
  writeFileSync(join(dir, 'del-database.json'), JSON.stringify(permessiDelDatabase));
  const fuori = (nome: string) => join(dir, nome);
  const esito = spawnSync(process.execPath, ['check-migration-drift.mjs'], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 20_000,
    env: {
      NODE_ENV: 'test',
      PATH: process.env.PATH ?? '',
      SUPABASE_DB_URL: 'postgresql://finto@127.0.0.1:5432/finto',
      FINTI_PERMESSI: join(dir, 'del-database.json'),
      ...Object.fromEntries(Object.entries(env).map(([k, v]) => [k, v.replace('{dir}', dir)])),
    },
  });
  return { uscita: esito.status ?? -1, testo: `${esito.stdout}\n${esito.stderr}`, fuori };
}

function elenco(righe: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'r30-elenco-'));
  cartelle.push(dir);
  const f = join(dir, 'attesi.json');
  writeFileSync(f, typeof righe === 'string' ? righe : JSON.stringify(righe));
  return f;
}

describe('R30-022 — lo script di deriva guarda anche i permessi', () => {
  it('il database ricostruito che lascia leggere profiles ad anon è deriva (exit 2), e la riga lo dice', () => {
    const { uscita, testo } = lancia(RICOSTRUITO_APERTO, { PERMESSI_ATTESI: elenco(PRODUZIONE) });
    expect(uscita, testo).toBe(2);
    expect(testo).toContain('+ tabella|profiles|anon|SELECT');
  });

  it('un permesso che il sito vero ha e il database no è deriva anche lui', () => {
    const { uscita, testo } = lancia(PRODUZIONE.filter((r) => r.tipo !== 'funzione'), { PERMESSI_ATTESI: elenco(PRODUZIONE) });
    expect(uscita, testo).toBe(2);
    expect(testo).toContain('- funzione|negozio_approvato(uuid)|anon|EXECUTE');
  });

  it('permessi uguali (in un altro ordine): verde', () => {
    const { uscita, testo } = lancia([...PRODUZIONE].reverse(), { PERMESSI_ATTESI: elenco(PRODUZIONE) });
    expect(uscita, testo).toBe(0);
    expect(testo).toContain('coincidono');
  });

  it('un elenco storto non vale «nessuna differenza»: esce 1 e dice perché', () => {
    const storto = lancia(RICOSTRUITO_APERTO, { PERMESSI_ATTESI: elenco('non json') });
    expect(storto.uscita, storto.testo).toBe(1);
    expect(storto.testo).toContain('JSON');
    const vuoto = lancia(RICOSTRUITO_APERTO, { PERMESSI_ATTESI: elenco([]) });
    expect(vuoto.uscita, vuoto.testo).toBe(1);
  });

  it('PERMESSI_ESPORTA scrive i permessi del database collegato, pronti per fare da elenco', () => {
    const { uscita, testo, fuori } = lancia(RICOSTRUITO_APERTO, { PERMESSI_ESPORTA: '{dir}/esportati.json' });
    expect(uscita, testo).toBe(0);
    expect(existsSync(fuori('esportati.json'))).toBe(true);
    expect(JSON.parse(readFileSync(fuori('esportati.json'), 'utf8'))).toEqual(RICOSTRUITO_APERTO);
  });
});
