/**
 * R12-005 — Le prove che fanno girare tutto lo script del backup non avevano un `psql` finto: lo
 * script chiamava quello vero della macchina (scripts/backup-db.sh, dopo `command -v psql`).
 * Qui un `psql` trappola (scrive un file segno ed esce 1) sta in testa al PATH di chi lancia le
 * tre prove: se una prova lascia arrivare lo script al `psql` della macchina, il segno compare.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PROVE = [
  'tests/unit/la-copia-delle-foto-si-riapre-davvero.test.ts',
  'tests/unit/il-lavoro-notturno-accende-davvero-la-copia-delle-foto.test.ts',
  'tests/unit/la-copia-delle-foto-non-ripete-la-cancellazione.test.ts',
];

describe('R12-005 · le prove del backup non chiamano il psql vero della macchina', () => {
  it('con un psql trappola in testa al PATH, nessuna delle tre prove lo chiama', () => {
    const cartella = mkdtempSync(join(tmpdir(), 'trappola-psql-'));
    const segno = join(cartella, 'psql-chiamato');
    writeFileSync(join(cartella, 'psql'), `#!/usr/bin/env bash\necho chiamato > "${segno}"\nexit 1\n`);
    chmodSync(join(cartella, 'psql'), 0o755);
    const r = spawnSync('npx', ['vitest', 'run', ...PROVE, '--reporter=dot'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 240_000,
      env: { ...process.env, PATH: `${cartella}:${process.env.PATH ?? ''}` },
    });
    expect(existsSync(segno), 'una prova del backup ha chiamato il psql della macchina').toBe(false);
    expect(r.status, `${r.stdout}\n${r.stderr}`.slice(-1500)).toBe(0);
  }, 270_000);
});
