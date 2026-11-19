import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { passo } from './_lavoro-di-rilascio';

/**
 * R04-001 — Il riepilogo dopo il ritorno indietro buttava via la riga intera se conteneva un
 * DROP DEFAULT/IDENTITY/EXPRESSION, anche quando nella stessa riga c'era un DROP VIEW o un DROP
 * di colonna: e scriveva che nessuna migrazione toglie qualcosa. Qui gira il passo vero estratto
 * dal YAML, sotto `set -euo pipefail`, su migrazioni finte.
 */
const PASSO = 'Torna indietro, il sito appena pubblicato non risponde';
const scene: string[] = [];
afterAll(() => {
  for (const s of scene) rmSync(s, { recursive: true, force: true });
});

function riepilogoCon(migrazioni: Record<string, string>): string {
  const scena = mkdtempSync(join(tmpdir(), 'r04-ritorno-'));
  scene.push(scena);
  mkdirSync(join(scena, 'migrations'));
  for (const [nome, testo] of Object.entries(migrazioni)) writeFileSync(join(scena, 'migrations', nome), testo);
  const riepilogo = join(scena, 'riepilogo.md');
  writeFileSync(riepilogo, '');
  writeFileSync(join(scena, 'output.txt'), '');
  const r = spawnSync('bash', ['-c', `set -euo pipefail\n${passo(PASSO).run!}`], {
    cwd: scena,
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_STEP_SUMMARY: riepilogo,
      GITHUB_OUTPUT: join(scena, 'output.txt'),
      PRECEDENTE: '',
      MIGRAZIONI: String(Object.keys(migrazioni).length),
      MIGRAZIONI_ELENCO: Object.keys(migrazioni).join(' '),
    },
  });
  expect(r.status, r.stderr).toBe(1);
  return readFileSync(riepilogo, 'utf8');
}

describe('R04-001 · un DROP DEFAULT sulla stessa riga non nasconde un DROP vero', () => {
  it('901: DROP VIEW e DROP DEFAULT sulla stessa riga', () => {
    const r = riepilogoCon({ '901_vista_e_default.sql': 'DROP VIEW IF EXISTS v; ALTER TABLE t ALTER COLUMN c DROP DEFAULT;\n' });
    expect(r).toMatch(/TOLGONO o RINOMINANO/);
    expect(r).toMatch(/901_vista_e_default\.sql`: riga 1: DROP VIEW IF EXISTS v;/);
    expect(r).not.toMatch(/nessuna contiene/);
  });
  it('902: DROP DEFAULT e DROP di colonna separati da una virgola', () => {
    const r = riepilogoCon({ '902_default_e_colonna.sql': 'ALTER TABLE t ALTER COLUMN status DROP DEFAULT, DROP legacy_status;\n' });
    expect(r).toMatch(/TOLGONO o RINOMINANO/);
    expect(r).toMatch(/902_default_e_colonna\.sql`: riga 1:/);
    expect(r).not.toMatch(/nessuna contiene/);
  });
  it('902b: lo stesso, con ALTER TABLE sulla riga prima', () => {
    const r = riepilogoCon({ '906_a_capo.sql': 'ALTER TABLE t\n  ALTER COLUMN status DROP DEFAULT, DROP legacy_status;\n' });
    expect(r).toMatch(/TOLGONO o RINOMINANO/);
    expect(r).not.toMatch(/nessuna contiene/);
  });
  it('903: DROP IDENTITY, DROP EXPRESSION e poi DROP FUNCTION sulla stessa riga', () => {
    const r = riepilogoCon({ '903_identita_e_funzione.sql': 'ALTER TABLE t ALTER COLUMN a DROP IDENTITY; ALTER TABLE t ALTER COLUMN b DROP EXPRESSION; DROP FUNCTION IF EXISTS f();\n' });
    expect(r).toMatch(/TOLGONO o RINOMINANO/);
    expect(r).toMatch(/903_identita_e_funzione\.sql`: riga 1:/);
  });
  it('904: un DROP di colonna da solo resta segnalato', () => {
    const r = riepilogoCon({ '904_colonna.sql': 'ALTER TABLE t DROP legacy_status;\n' });
    expect(r).toMatch(/TOLGONO o RINOMINANO/);
  });
  it('solo DROP DEFAULT: il filtro serve ancora, niente avviso', () => {
    const r = riepilogoCon({ '907_solo_default.sql': 'ALTER TABLE t ALTER COLUMN c DROP DEFAULT;\n' });
    expect(r).not.toMatch(/TOLGONO o RINOMINANO/);
    expect(r).toMatch(/nessuna contiene/);
  });
});
