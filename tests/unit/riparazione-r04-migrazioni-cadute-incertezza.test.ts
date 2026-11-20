import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { passo } from './_lavoro-di-rilascio';

/**
 * R04-002 — Se lo script delle migrazioni cade dopo un file, il riepilogo non deve accusare una
 * migrazione sana («quella che si e' rotta») ne' rassicurare («nessuna migrazione da correggere»)
 * quando la caduta e' a meta' di un file con il suo COMMIT: con uscita diversa da 3 resta
 * l'incertezza. Gira il passo vero estratto dal YAML e lo script vero, con un psql finto.
 */
const PASSO = 'Applica le migrazioni al database, prima di pubblicare';
const scene: string[] = [];
afterAll(() => {
  for (const s of scene) rmSync(s, { recursive: true, force: true });
});

const PSQL_FINTO = (scena: string) => `#!/usr/bin/env bash
S="${scena}"
args="$(printf "%s " "$*" | tr "\n" " ")"
case "$args" in
  *"-f "*)
    f="\${args##*-f }"; f="\${f%% *}"
    if [ "$(basename "$f")" = "$CADE_NEL_FILE" ]; then
      echo "psql: error: connection to server was lost" >&2
      exit "\${USCITA_CADUTA:-2}"
    fi
    exit 0 ;;
  *"INSERT INTO"*)
    v="$(printf '%s' "$args" | sed -E "s/.*VALUES \\('([^']*)'.*/\\1/")"
    echo "$v" >> "$S/registro.txt"
    exit 0 ;;
  *"count(*)"*) wc -l < "$S/registro.txt" | tr -d ' '; exit 0 ;;
  *"LIMIT 1"*)
    v="$(printf '%s' "$args" | sed -E "s/.*version = '([^']*)'.*/\\1/")"
    if [ "$v" = "$CADE_AL_CONTROLLO_DI" ]; then
      n=$(( $(cat "$S/conta" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$S/conta"
      if [ "$n" -ge 2 ]; then echo "psql: error: server closed the connection unexpectedly" >&2; exit 2; fi
    fi
    if grep -qx "$v" "$S/registro.txt"; then echo 1; fi
    exit 0 ;;
esac
exit 0
`;

function giro(migrazioni: Record<string, string>, ambiente: Record<string, string>) {
  const scena = mkdtempSync(join(tmpdir(), 'r04-cadute-'));
  scene.push(scena);
  mkdirSync(join(scena, 'bin'));
  mkdirSync(join(scena, 'mig'));
  for (const [n, t] of Object.entries(migrazioni)) writeFileSync(join(scena, 'mig', n), t);
  writeFileSync(join(scena, 'registro.txt'), '');
  writeFileSync(join(scena, 'output.txt'), '');
  writeFileSync(join(scena, 'riepilogo.md'), '');
  writeFileSync(join(scena, 'bin', 'sudo'), '#!/usr/bin/env bash\nexit 0\n');
  writeFileSync(join(scena, 'bin', 'psql'), PSQL_FINTO(scena));
  chmodSync(join(scena, 'bin', 'sudo'), 0o755);
  chmodSync(join(scena, 'bin', 'psql'), 0o755);
  const r = spawnSync('bash', ['-c', passo(PASSO).run!], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${join(scena, 'bin')}:${process.env.PATH}`,
      SUPABASE_DB_URL: 'postgresql://finto@localhost/finto',
      MASSIMO_MIGRAZIONI: '20',
      CARTELLA_MIGRAZIONI: join(scena, 'mig'),
      GITHUB_OUTPUT: join(scena, 'output.txt'),
      GITHUB_STEP_SUMMARY: join(scena, 'riepilogo.md'),
      CADE_NEL_FILE: '',
      CADE_AL_CONTROLLO_DI: '',
      ...ambiente,
    },
  });
  return { uscita: r.status, riepilogo: readFileSync(join(scena, 'riepilogo.md'), 'utf8'), out: r.stdout + r.stderr };
}

describe('R04-002 · il riepilogo dopo una caduta dello script delle migrazioni', () => {
  it('(a) caduta fra un file e il successivo: la 001 sana non e\' accusata', () => {
    const e = giro(
      { '001_buona.sql': 'CREATE TABLE a (id int);\n', '002_dopo.sql': 'CREATE TABLE b (id int);\n' },
      { CADE_AL_CONTROLLO_DI: '002' },
    );
    expect(e.uscita, e.out).toBe(2);
    expect(e.riepilogo).toMatch(/database e' avanti/);
    expect(e.riepilogo).not.toMatch(/Quella che si e' rotta: `001_buona\.sql`/);
    expect(e.riepilogo).not.toMatch(/correggi la migrazione rotta/);
    expect(e.riepilogo).toMatch(/L'ultima cominciata: `001_buona\.sql`/);
  });

  it('(b) caduta a meta\' di un file col suo COMMIT: non dice «Nessuna migrazione da correggere» e tiene l\'avviso', () => {
    const e = giro(
      {
        '001_buona.sql': 'CREATE TABLE a (id int);\n',
        '002_con_commit.sql': 'BEGIN;\nCREATE TABLE b (id int);\nCOMMIT;\nBEGIN;\nALTER TABLE b ADD COLUMN c int;\nCOMMIT;\n',
      },
      { CADE_NEL_FILE: '002_con_commit.sql' },
    );
    expect(e.uscita, e.out).toBe(2);
    expect(e.riepilogo).toMatch(/L'ultima cominciata: `002_con_commit\.sql`/);
    expect(e.riepilogo).toMatch(/rimasta a meta'/);
    expect(e.riepilogo).not.toMatch(/Nessuna migrazione da correggere/);
  });

  it('(c) un errore nell\'SQL del file (uscita 3) si chiama ancora «quella che si e\' rotta»', () => {
    const e = giro({ '001_rotta.sql': 'SELECT * FROM non_esiste;\n' }, { CADE_NEL_FILE: '001_rotta.sql', USCITA_CADUTA: '3' });
    expect(e.uscita, e.out).toBe(3);
    expect(e.riepilogo).toMatch(/Quella che si e' rotta: `001_rotta\.sql`/);
    expect(e.riepilogo).toMatch(/correggi la migrazione rotta/);
    expect(e.riepilogo).not.toMatch(/L'ultima cominciata/);
  });
});
