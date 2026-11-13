import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * R01-011 — Se sulla macchina delle prove mancava PostgreSQL, sette file di prova si saltavano
 * in silenzio e la verifica usciva verde lo stesso. Nella CI adesso PostgreSQL si installa, e un
 * passo prima delle prove si ferma rosso se non risponde.
 */
const YML = readFileSync('.github/workflows/ci.yml', 'utf8');

/** Lo script di un passo del lavoro unit-tests: le righe sotto `run: |` piu' rientrate della chiave. */
function scriptDelPasso(nome: string): string | null {
  const righe = YML.split('\n');
  const i = righe.findIndex((r) => r.trim() === `- name: ${nome}`);
  if (i < 0) return null;
  const j = righe.findIndex((r, k) => k > i && /^\s+run: \|\s*$/.test(r));
  if (j < 0) return null;
  const rientro = righe[j].length - righe[j].trimStart().length;
  const corpo: string[] = [];
  for (const r of righe.slice(j + 1)) {
    if (r.trim() !== '' && r.length - r.trimStart().length <= rientro) break;
    corpo.push(r);
  }
  return corpo.join('\n');
}

const GUARDIA = 'Le prove col database vero non si possono saltare';

function lanciaGuardia(psqlRisponde: boolean) {
  const scena = mkdtempSync(join(tmpdir(), 'r01-ci-'));
  try {
    const bin = join(scena, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'psql'), `#!/usr/bin/env bash\nexit ${psqlRisponde ? 0 : 2}\n`);
    chmodSync(join(bin, 'psql'), 0o755);
    return spawnSync('bash', ['-c', scriptDelPasso(GUARDIA)!], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, PGHOST: '/var/run/postgresql' },
    });
  } finally {
    rmSync(scena, { recursive: true, force: true });
  }
}

describe('R01-011 · nella CI le prove col database vero non si saltano in silenzio', () => {
  const lavoro = YML.slice(YML.indexOf('  unit-tests:'), YML.indexOf('  integration-tests:'));

  it('il lavoro delle prove installa PostgreSQL e lo controlla prima di lanciarle', () => {
    const installa = lavoro.indexOf('- name: Installa e accendi PostgreSQL');
    const guardia = lavoro.indexOf(`- name: ${GUARDIA}`);
    const prove = lavoro.indexOf('- name: Test');
    expect(installa).toBeGreaterThan(0);
    expect(guardia).toBeGreaterThan(installa);
    expect(prove).toBeGreaterThan(guardia);
  });

  it('se PostgreSQL non risponde, la guardia si ferma rossa', () => {
    const r = lanciaGuardia(false);
    expect(r.status).not.toBe(0);
    expect(r.stdout).toMatch(/::error::/);
  });

  it('se PostgreSQL risponde e initdb c\'e\', la guardia lascia passare', () => {
    // Su una macchina senza initdb questa prova cade, e la guardia dice perche': e' voluto.
    const r = lanciaGuardia(true);
    expect(r.status, r.stdout).toBe(0);
  });
});
