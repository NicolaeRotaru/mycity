import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** S03 — scheda 1599: la passphrase della copia non passa sulla riga di comando di gpg. */
describe('la passphrase della copia', () => {
  it('nessun gpg riceve la passphrase come argomento (si legge in /proc/<pid>/cmdline)', () => {
    for (const f of ['scripts/backup-db.sh', 'scripts/copia-foto.sh', '.github/workflows/backup-db.yml']) {
      const testo = readFileSync(f, 'utf8');
      expect(testo, f).not.toMatch(/--passphrase\s+"\$/);
      expect(testo, f).toMatch(/--passphrase-fd 3[^\n]*(\n[^\n]*)?3<<<"\$BACKUP_PASSPHRASE"/);
    }
  });
});
