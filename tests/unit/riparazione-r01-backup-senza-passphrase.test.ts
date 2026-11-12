import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * R01-025 — Il backup copiava anche auth.mfa_factors (i segreti da cui nascono i codici della
 * doppia verifica), e senza BACKUP_PASSPHRASE il file restava in chiaro per trenta giorni.
 *
 * Qui lo script vero gira con un `pg_dump` e un `gpg` finti che annotano cosa e' stato chiesto.
 */
function lancia(passphrase: string | undefined) {
  const base = mkdtempSync(join(tmpdir(), 'r01-backup-'));
  const finti = join(base, 'bin');
  mkdirSync(finti);
  const diario = join(base, 'chiamate.txt');
  writeFileSync(join(finti, 'pg_dump'),
    '#!/usr/bin/env bash\n' +
    `echo "pg_dump $*" >> "${diario}"\n` +
    'for a in "$@"; do case "$a" in --file=*) echo dati > "${a#--file=}";; esac; done\n');
  writeFileSync(join(finti, 'gpg'),
    '#!/usr/bin/env bash\n' +
    `echo "gpg" >> "${diario}"\n` +
    'out=""; prev=""; for a in "$@"; do [ "$prev" = "--output" ] && out="$a"; prev="$a"; done; echo cifrato > "$out"\n');
  chmodSync(join(finti, 'pg_dump'), 0o755);
  chmodSync(join(finti, 'gpg'), 0o755);
  const env: Record<string, string> = {
    PATH: `${finti}:${process.env.PATH ?? ''}`,
    HOME: base,
    SUPABASE_DB_URL: 'postgresql://utente:segreto@db.example.com:5432/postgres',
    BACKUP_DIR: join(base, 'copie'),
  };
  if (passphrase) env.BACKUP_PASSPHRASE = passphrase;
  const r = spawnSync('bash', [join(process.cwd(), 'scripts/backup-db.sh')], { env, encoding: 'utf8' });
  const chiamate = existsSync(diario) ? readFileSync(diario, 'utf8') : '';
  return { r, chiamate };
}

describe('R01-025 · senza passphrase i segreti della doppia verifica non escono in chiaro', () => {
  it('senza BACKUP_PASSPHRASE il dump degli utenti non contiene auth.mfa_factors e lo dice', () => {
    const { r, chiamate } = lancia(undefined);
    expect(chiamate).toMatch(/--table=auth\.users/);
    expect(chiamate).not.toMatch(/auth\.mfa_factors/);
    expect(r.stderr).toMatch(/mfa_factors/);
  });

  it('con BACKUP_PASSPHRASE la tabella si copia, e la copia si cifra', () => {
    const { chiamate } = lancia('una-passphrase-di-prova');
    expect(chiamate).toMatch(/--table=auth\.mfa_factors/);
    expect(chiamate).toMatch(/^gpg$/m);
  });
});
