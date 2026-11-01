// Un invito scritto a mano non paga, nemmeno a inviti riaccesi (migrazione 186).
//
// Il difetto: la policy INSERT su `referrals` lasciava a ogni utente collegato
// scrivere «mi ha invitato A»; alla prima consegna dell'invitato il trigger
// della 089 accredita 5 euro di credito vero ad A. La 168 lo spegne finche'
// punti_fedelta_accesi() e' false, ma alla riaccensione la porta era aperta.
//
// La prova vera e' SQL (tests/sql/rls/45-…): ricostruisce il database dalle
// migrazioni su un Postgres locale e simula la riaccensione dentro una
// transazione con ROLLBACK. Qui la si fa girare da vitest, cosi' cade se la 186
// manca. Senza un Postgres raggiungibile la prova si salta (lo dice), non
// diventa un verde finto.
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const DB = 'mycity_invito_vitest';
const env = {
  ...process.env,
  PGHOST: process.env.PGHOST ?? '/var/run/postgresql',
  PGUSER: process.env.PGUSER ?? 'root',
};

const postgresRaggiungibile =
  spawnSync('psql', ['-X', '-d', 'postgres', '-Atc', 'select 1'], { env, encoding: 'utf8' }).status === 0;

describe.skipIf(!postgresRaggiungibile)('un invito scritto a mano non paga (186)', () => {
  it('rifiuta l\'invito del cliente e non accredita il premio alla consegna', () => {
    execFileSync('bash', [join(ROOT, 'tests/sql/harness/apply.sh'), DB], { env, stdio: 'pipe' });
    const r = spawnSync(
      'psql',
      ['-X', '-d', DB, '-v', 'ON_ERROR_STOP=1', '-f',
        join(ROOT, 'tests/sql/rls/45-un-invito-scritto-a-mano-non-paga-alla-riaccensione.test.sql')],
      { env, encoding: 'utf8' },
    );
    spawnSync('psql', ['-X', '-d', 'postgres', '-c', `DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`], { env });
    const uscita = `${r.stdout}\n${r.stderr}`;
    expect(uscita).not.toMatch(/ROTTO/);
    expect(uscita).toMatch(/1 invito a mano: rifiutato\s*\|\s*ok/);
    expect(uscita).toMatch(/2 consegna di Bruno: niente premio ad Anna\s*\|\s*ok/);
    expect(uscita).toMatch(/3 invito del server: un premio solo\s*\|\s*ok/);
    expect(r.status).toBe(0);
  }, 120_000);
});
