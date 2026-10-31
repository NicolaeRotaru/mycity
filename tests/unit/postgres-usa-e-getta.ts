/**
 * UN POSTGRES VERO, USA E GETTA, PER LE PROVE CHE PARLANO DI SQL.
 *
 * Una regola che vive in una migrazione si prova solo eseguendola: leggerla
 * come testo e' cercare una parola, e una parola non fallisce nel modo in cui
 * fallisce il database. Qui si accende un cluster nuovo in una cartella
 * temporanea, solo sul socket (nessuna porta aperta), lo si usa e lo si butta.
 *
 * Se sulla macchina non ci sono i programmi di PostgreSQL, `BIN_POSTGRES` e'
 * null e le prove che lo usano si saltano DICHIARANDOLO (describe.skipIf): un
 * salto e' scritto nel riassunto di vitest, un verde finto no.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function cartellaDeiProgrammi(): string | null {
  const daAmbiente = process.env.PG_BIN;
  if (daAmbiente && existsSync(join(daAmbiente, 'initdb'))) return daAmbiente;
  const base = '/usr/lib/postgresql';
  if (existsSync(base)) {
    const versioni = readdirSync(base)
      .filter((v) => existsSync(join(base, v, 'bin', 'initdb')))
      .sort((a, b) => Number(b) - Number(a));
    if (versioni.length > 0) return join(base, versioni[0], 'bin');
  }
  try {
    const cartella = execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim();
    if (existsSync(join(cartella, 'initdb'))) return cartella;
  } catch {
    // pg_config non c'e': resta null, e le prove si saltano dicendolo.
  }
  return null;
}

export const BIN_POSTGRES = cartellaDeiProgrammi();

export type Postgres = {
  /** Esegue lo SQL e restituisce quello che stampa (righe senza intestazioni). */
  psql(sql: string): string;
  ferma(): void;
};

function esegui(programma: string, argomenti: string[], input?: string): string {
  try {
    return execFileSync(programma, argomenti, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    throw new Error(`${programma} ${argomenti.slice(0, 2).join(' ')}: ${err.stderr || err.message}`);
  }
}

export function avviaPostgres(): Postgres {
  if (!BIN_POSTGRES) throw new Error('PostgreSQL non installato su questa macchina');
  const bin = BIN_POSTGRES;
  // initdb rifiuta di girare come root: da root il server gira come `postgres`.
  const daRoot = process.getuid?.() === 0;
  const cartella = mkdtempSync(join(existsSync('/tmp') ? '/tmp' : tmpdir(), 'pg-prova-'));
  chmodSync(cartella, 0o777);
  const server = (programma: string, argomenti: string[]) =>
    daRoot
      ? esegui('runuser', ['-u', 'postgres', '--', join(bin, programma), ...argomenti])
      : esegui(join(bin, programma), argomenti);
  const dati = join(cartella, 'dati');
  server('initdb', ['-D', dati, '-U', 'postgres', '--auth=trust', '-E', 'UTF8', '--no-locale', '--no-sync']);
  server('pg_ctl', ['-D', dati, '-l', join(cartella, 'registro.log'), '-w', '-o', `-k ${cartella} -c listen_addresses='' -F`, 'start']);
  return {
    psql: (sql) =>
      esegui(join(bin, 'psql'), ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-h', cartella, '-U', 'postgres', '-d', 'postgres'], sql).trim(),
    ferma: () => {
      try {
        server('pg_ctl', ['-D', dati, '-m', 'immediate', '-w', 'stop']);
      } finally {
        rmSync(cartella, { recursive: true, force: true });
      }
    },
  };
}
