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
import crypto from 'node:crypto';

const DB_URL = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
const MIGRATIONS_DIR = path.resolve(process.cwd(), 'migrations');
const NAME_RE = /^(\d{3}[a-z]?)_([a-z0-9_]+)\.sql$/;

/**
 * #46 — Si confronta anche il PREFISSO NUMERICO e il CONTENUTO, non solo il
 * nome.
 *
 * Prima il confronto era `applied.has(m.name)`, cioe' solo la parte descrittiva
 * del nome file. Due conseguenze: due migrazioni con lo stesso nome e numero
 * diverso (e capita: `108_x` e `108b_x`) risultavano la stessa cosa, e una
 * migrazione MODIFICATA dopo essere stata applicata risultava «a posto» —
 * mentre il database ha ancora la versione vecchia. Il controllo diceva verde
 * proprio nel caso che doveva prendere.
 */
function repoMigrationNames() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .map((f) => f.match(NAME_RE))
    .filter(Boolean)
    .map((m) => {
      const file = `${m[1]}_${m[2]}.sql`;
      const contenuto = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      return {
        prefix: m[1],
        name: m[2],
        file,
        impronta: crypto.createHash('md5').update(contenuto).digest('hex'),
      };
    });
}

async function main() {
  // #46 — «Saltato» non e' «passato». Con SALTO_E_ERRORE=1 (la CI di
  // produzione) l'assenza della connessione e' un errore, non un verde: un
  // controllo che non ha controllato niente non deve sembrare superato.
  const saltoEErrore = process.env.SALTO_E_ERRORE === '1';
  if (!DB_URL) {
    console.log(`${saltoEErrore ? '❌' : '⏭️ '} check-migration-drift: ${saltoEErrore ? 'ERRORE' : 'SALTATO'} — manca SUPABASE_DB_URL.`);
    console.log('    Imposta la connection string Postgres (Supabase > Project Settings > Database):');
    console.log('    SUPABASE_DB_URL="postgresql://postgres:<pwd>@db.<ref>.supabase.co:5432/postgres"');
    process.exit(saltoEErrore ? 1 : 0);
  }

  let pg;
  try {
    pg = await import('pg');
  } catch {
    console.log('⏭️  check-migration-drift: SALTATO — pacchetto "pg" non installato. Esegui: npm i -D pg');
    process.exit(saltoEErrore ? 1 : 0);
  }

  const client = new pg.default.Client({ connectionString: DB_URL });
  await client.connect();
  let applicate;
  try {
    // `version` e' il prefisso numerico, `name` la parte descrittiva: servono
    // tutti e due per riconoscere una migrazione (#46).
    const res = await client.query('SELECT version, name FROM supabase_migrations.schema_migrations');
    applicate = res.rows.map((r) => ({ version: String(r.version ?? ''), name: String(r.name ?? '') }));
  } finally {
    await client.end();
  }

  const repo = repoMigrationNames();
  const perNome = new Set(applicate.map((a) => a.name));
  const perVersione = new Set(applicate.map((a) => a.version));

  // Una migrazione risulta applicata se il database conosce il suo numero
  // OPPURE il suo nome: i due elenchi storici non sono allineati al 100%, e
  // pretendere entrambi darebbe falsi allarmi su tutto il passato.
  const missing = repo.filter((m) => !perNome.has(m.name) && !perVersione.has(m.prefix));

  if (missing.length === 0) {
    console.log(`✅ check-migration-drift: tutte le ${repo.length} migrazioni risultano applicate.`);
    // #46 — L'impronta del contenuto, per chi verra' dopo. Il registro di
    // Supabase non la conserva, quindi qui la si stampa: chi indaga un guasto
    // puo' confrontare l'impronta di oggi con quella scritta nel log del
    // rilascio in cui la migrazione e' stata applicata, e vedere se il file e'
    // stato toccato da allora.
    for (const m of repo.slice(-5)) console.log(`   ${m.file} · md5 ${m.impronta}`);
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
