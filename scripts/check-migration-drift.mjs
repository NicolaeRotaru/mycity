#!/usr/bin/env node
/**
 * check-migration-drift — rileva il "drift" tra i file in migrations/ e le
 * migration effettivamente APPLICATE sul database.
 *
 * Motivazione: e' gia' successo di committare un file migration (es. 067) senza
 * applicarlo al DB. Gli unit test non lo vedono; i test d'integrazione coprono
 * solo gli effetti delle migration di sicurezza. Questo script chiude il cerchio
 * confrontando i nomi dei file con la tabella di tracking di Supabase
 * (supabase_migrations.schema_migrations).
 *
 * Uso:
 *   SUPABASE_DB_URL="postgresql://...:5432/postgres" node scripts/check-migration-drift.mjs
 *   (oppure: npm run db:check-drift)
 *
 * Comportamento:
 *   - manca SUPABASE_DB_URL  -> SKIP (exit 0), stampa come configurarlo
 *   - manca il pacchetto pg  -> SKIP (exit 0), suggerisce `npm i -D pg`
 *   - drift rilevato         -> exit 1 con l'elenco dei file non applicati
 *   - tutto applicato        -> exit 0
 *
 * Pensato per girare in locale/CI in un job OPT-IN (richiede la connection
 * string con password: NON metterla in un workflow pubblico senza secret).
 */
import fs from 'node:fs';
import path from 'node:path';

const DB_URL = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
const MIGRATIONS_DIR = path.resolve(process.cwd(), 'migrations');
const NAME_RE = /^(\d{3}[a-z]?)_([a-z0-9_]+)\.sql$/;

function repoMigrationNames() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .map((f) => f.match(NAME_RE))
    .filter(Boolean)
    .map((m) => ({ prefix: m[1], name: m[2], file: `${m[1]}_${m[2]}.sql` }));
}

async function main() {
  if (!DB_URL) {
    console.log('⏭️  check-migration-drift: SKIP — manca SUPABASE_DB_URL.');
    console.log('    Imposta la connection string Postgres (Supabase > Project Settings > Database):');
    console.log('    SUPABASE_DB_URL="postgresql://postgres:<pwd>@db.<ref>.supabase.co:5432/postgres"');
    process.exit(0);
  }

  let pg;
  try {
    pg = await import('pg');
  } catch {
    console.log('⏭️  check-migration-drift: SKIP — pacchetto "pg" non installato. Esegui: npm i -D pg');
    process.exit(0);
  }

  const client = new pg.default.Client({ connectionString: DB_URL });
  await client.connect();
  let applied;
  try {
    const res = await client.query('SELECT name FROM supabase_migrations.schema_migrations');
    applied = new Set(res.rows.map((r) => r.name));
  } finally {
    await client.end();
  }

  const repo = repoMigrationNames();
  const missing = repo.filter((m) => !applied.has(m.name));

  if (missing.length === 0) {
    console.log(`✅ check-migration-drift: tutte le ${repo.length} migration risultano applicate.`);
    process.exit(0);
  }

  console.error(`❌ check-migration-drift: ${missing.length} migration NON applicate al DB:`);
  for (const m of missing) console.error(`   - ${m.file}`);
  console.error('\nApplicale (Supabase SQL editor / CLI / MCP apply_migration) e rilancia.');
  console.error('Nota: migration storiche pre-tracking potrebbero comparire qui; in tal caso');
  console.error('verifica manualmente e, se gia\' applicate, ignorale.');
  process.exit(1);
}

main().catch((err) => {
  console.error('check-migration-drift: errore', err);
  process.exit(1);
});
