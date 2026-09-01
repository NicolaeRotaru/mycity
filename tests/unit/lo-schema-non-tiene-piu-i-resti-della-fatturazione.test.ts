import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * 30/8/2026 (R035) — TRE COLONNE DELLA FATTURAZIONE RIMASTE SU `orders`.
 *
 * La migrazione 105 ha tolto la fatturazione «a tutti i livelli», ma su
 * `orders` erano rimaste vive `invoice_sdi_status` (col suo vincolo),
 * `invoice_sdi_id` e `invoice_issued_at`. Nessuna riga di codice le scrive o le
 * legge. Il guaio non e' lo spazio occupato: e' che `orders` e' la tabella che
 * si apre quando un pagamento non torna, e un campo chiamato «fattura emessa
 * il» fa credere a chi legge che da qualche parte una fattura esista. MyCity
 * non ne emette per gli ordini.
 *
 * Questa prova non cerca parole in un file: ricostruisce davvero lo schema
 * partendo dalle migrazioni, con lo stesso generatore che il progetto usa per
 * `lib/database.types.ts` (`scripts/gen-db-types.mjs`), dentro una cartella
 * usa-e-getta — cosi' non tocca niente qui. Se la migrazione 134 sparisce o
 * viene svuotata, le tre colonne ricompaiono nello schema ricostruito e questa
 * prova diventa rossa.
 */
describe('lo schema ricostruito dalle migrazioni', () => {
  it('su orders non ha piu le colonne della fatturazione tolta', () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'schema-ordini-'));
    try {
      mkdirSync(join(sandbox, 'lib'));
      mkdirSync(join(sandbox, 'scripts'));
      cpSync('migrations', join(sandbox, 'migrations'), { recursive: true });
      cpSync('scripts/gen-db-types.mjs', join(sandbox, 'scripts', 'gen-db-types.mjs'));

      execFileSync(process.execPath, [join(sandbox, 'scripts', 'gen-db-types.mjs')], { stdio: 'pipe' });
      const tipi = readFileSync(join(sandbox, 'lib', 'database.types.ts'), 'utf8');

      const righeOrdini = /\n {6}orders: \{\n {8}Row: \{\n([\s\S]*?)\n {8}\};/.exec(tipi)?.[1];
      expect(righeOrdini, 'lo schema ricostruito non contiene nemmeno la tabella degli ordini: il generatore non ha funzionato').toBeTruthy();

      // Controprova che stiamo guardando la tabella giusta e non una vuota.
      expect(righeOrdini).toContain('total_price');

      for (const colonna of ['invoice_sdi_status', 'invoice_sdi_id', 'invoice_issued_at']) {
        expect(
          righeOrdini,
          `«${colonna}» e ancora sulla tabella degli ordini: chi la legge crede che per quell ordine esista una fattura`,
        ).not.toContain(colonna);
      }
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  }, 30_000);
});
