import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * R13-003 — la guida al backup deve dire che con un remote cifrato (crypt) o un alias
 * lo storico delle foto si imposta a mano (STORAGE_SYNC_STORICO), e come.
 */
const guida = readFileSync(join(process.cwd(), 'docs', 'backup-restore.md'), 'utf8').replace(/\s*\n>?\s*/g, ' ');

describe('R13-003 — guida al backup: remote cifrato o alias', () => {
  it('nomina crypt e alias e dice che lo storico si imposta a mano', () => {
    expect(guida).toMatch(/remote cifrato \(`crypt`\) o un alias, lo storico si imposta a mano/);
  });
  it('dice come: STORAGE_SYNC_STORICO con un secchio diverso da quello della copia', () => {
    expect(guida).toMatch(/imposta `STORAGE_SYNC_STORICO` a mano, con un secchio diverso da quello della copia/);
    expect(guida).toContain('STORAGE_SYNC_STORICO=b2:mycity-foto-storico/copie');
  });
});
