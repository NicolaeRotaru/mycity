import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * R01-012 — La prova mensile di ripristino ingoiava gli errori di pg_restore (`|| true`) e
 * contava solo le righe: avrebbe detto «si riapre» anche con tabelle tornate senza regole di
 * accesso. Qui il passo vero gira con gpg, pg_restore e psql finti: il database «ripristinato»
 * ha le righe, ma una tabella torna con la RLS spenta.
 */
/** Lo script del passo, letto dal file: le righe sotto `run: |` piu' rientrate della chiave. */
function scriptDelPasso(nome: string): string | null {
  const righe = readFileSync('.github/workflows/backup-db.yml', 'utf8').split('\n');
  const i = righe.findIndex((r) => r.trim() === `- name: ${nome}`);
  if (i < 0) return null;
  const j = righe.findIndex((r, k) => k > i && /^\s+run: \|\s*$/.test(r));
  if (j < 0) return null;
  const rientroChiave = righe[j].length - righe[j].trimStart().length;
  const corpo: string[] = [];
  for (const r of righe.slice(j + 1)) {
    if (r.trim() !== '' && r.length - r.trimStart().length <= rientroChiave) break;
    corpo.push(r);
  }
  return corpo.join('\n');
}
const passo = { run: scriptDelPasso('Riaprila su un database vuoto, e cronometra') };

function lancia(senzaRls: string, regole: string, erroriPerRestore = 1) {
  const scena = mkdtempSync(join(tmpdir(), 'r01-ripr-'));
  try {
    const bin = join(scena, 'bin');
    const copie = join(scena, 'backup');
    mkdirSync(bin);
    mkdirSync(copie);
    writeFileSync(join(copie, 'mycity_20261101_021700.dump.gpg'), 'x');
    writeFileSync(join(copie, 'mycity_20261101_021700_utenti.dump.gpg'), 'x');
    const finto = (nome: string, corpo: string) => {
      writeFileSync(join(bin, nome), `#!/usr/bin/env bash\n${corpo}\n`);
      chmodSync(join(bin, nome), 0o755);
    };
    finto('gpg', 'out=""; prev=""; for a in "$@"; do [ "$prev" = "--output" ] && out="$a"; prev="$a"; done; echo x > "$out"');
    finto('pg_restore', [
      'for a in "$@"; do',
      '  if [ "$a" = "-l" ]; then echo "1; 2 3 TABLE auth users postgres"; echo "4; 5 6 TRIGGER auth users on_auth_user_created postgres"; exit 0; fi',
      'done',
      `for i in $(seq 1 ${erroriPerRestore}); do echo "pg_restore: error: role \\"supabase_admin\\" does not exist ($i)" >&2; done`,
      'exit 1',
    ].join('\n'));
    finto('psql', [
      'q="$*"',
      'case "$q" in',
      `  *relrowsecurity*) echo "${senzaRls}" ;;`,
      `  *pg_policies*) echo "${regole}" ;;`,
      '  *"count(*)"*) echo 12 ;;',
      'esac',
      'exit 0',
    ].join('\n'));
    const riepilogo = join(scena, 'riepilogo.md');
    writeFileSync(riepilogo, '');
    const script = passo!.run!.replaceAll('${{ github.workspace }}', scena);
    const r = spawnSync('bash', ['-c', script], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, BACKUP_PASSPHRASE: 'p', GITHUB_STEP_SUMMARY: riepilogo },
    });
    return { r, riepilogo: readFileSync(riepilogo, 'utf8') };
  } finally {
    rmSync(scena, { recursive: true, force: true });
  }
}

describe('R01-012 · la prova di ripristino guarda le regole di accesso e gli errori', () => {
  it('il passo esiste', () => { expect(passo?.run).toBeTruthy(); });

  it('una tabella tornata con la RLS spenta fa fallire la prova', () => {
    const { r } = lancia('orders', '120');
    expect(r.status).not.toBe(0);
    expect(r.stdout).toMatch(/SENZA regole di accesso[^\n]*orders/);
  });

  it('nessuna regola di accesso tornata fa fallire la prova', () => {
    const { r } = lancia('', '0');
    expect(r.status).not.toBe(0);
    expect(r.stdout).toMatch(/solo 0 regole di accesso/);
  });

  it('meta\' delle regole perse fa fallire la prova, non solo zero', () => {
    const { r } = lancia('', '36');
    expect(r.status).not.toBe(0);
    expect(r.stdout).toMatch(/solo 36 regole di accesso/);
  });

  it('migliaia di errori di pg_restore non fanno morire il passo prima dei controlli', () => {
    const { r, riepilogo } = lancia('', '132', 2000);
    expect(r.status, r.stderr).toBe(0);
    expect(riepilogo).toMatch(/Errori di pg_restore durante la prova \(\d+\)/);
  });

  it('prima di ripristinare monta l\'impalcatura di Supabase (ruoli e auth.uid)', () => {
    expect(passo.run).toMatch(/00_shim_supabase\.sql/);
  });

  it('con le regole tornate passa, e gli errori di pg_restore finiscono nel riepilogo', () => {
    const { r, riepilogo } = lancia('', '120');
    expect(r.status, r.stderr).toBe(0);
    expect(riepilogo).toMatch(/Errori di pg_restore durante la prova \(3\)/);
    expect(riepilogo).toMatch(/supabase_admin/);
    expect(riepilogo).toMatch(/La copia si riapre: \*\*sì\*\*/);
  });
});
