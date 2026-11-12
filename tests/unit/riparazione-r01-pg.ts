/**
 * Un PostgreSQL usa e getta che restituisce anche il suo indirizzo, per le prove R01 che lanciano
 * gli script del rilascio (`psql "$SUPABASE_DB_URL"`). Gli stessi passi di
 * tests/unit/postgres-usa-e-getta.ts, che l'indirizzo non lo espone.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BIN_POSTGRES } from './postgres-usa-e-getta';

export { BIN_POSTGRES };

export type PostgresConIndirizzo = { url: string; psql(sql: string): string; ferma(): void };

export function avviaPostgresConIndirizzo(): PostgresConIndirizzo {
  if (!BIN_POSTGRES) throw new Error('PostgreSQL non installato su questa macchina');
  const bin = BIN_POSTGRES;
  const daRoot = process.getuid?.() === 0;
  const cartella = mkdtempSync(join(existsSync('/tmp') ? '/tmp' : tmpdir(), 'pg-r01-'));
  chmodSync(cartella, 0o777);
  const server = (programma: string, argomenti: string[]) =>
    daRoot
      ? execFileSync('runuser', ['-u', 'postgres', '--', join(bin, programma), ...argomenti], { stdio: 'pipe' })
      : execFileSync(join(bin, programma), argomenti, { stdio: 'pipe' });
  const dati = join(cartella, 'dati');
  server('initdb', ['-D', dati, '-U', 'postgres', '--auth=trust', '-E', 'UTF8', '--no-locale', '--no-sync']);
  server('pg_ctl', ['-D', dati, '-l', join(cartella, 'registro.log'), '-w', '-o', `-k ${cartella} -c listen_addresses='' -F`, 'start']);
  const url = `postgresql://postgres@/postgres?host=${encodeURIComponent(cartella)}`;
  return {
    url,
    psql: (sql) =>
      execFileSync(join(bin, 'psql'), ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', url], { input: sql, encoding: 'utf8' }).trim(),
    ferma: () => {
      try {
        server('pg_ctl', ['-D', dati, '-m', 'immediate', '-w', 'stop']);
      } finally {
        rmSync(cartella, { recursive: true, force: true });
      }
    },
  };
}
