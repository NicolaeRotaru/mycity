import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * S03 — scheda 795. Il ritorno indietro del rilascio rimette il codice di prima, non lo schema: una
 * migrazione nuova che TOGLIE qualcosa (DROP COLUMN, DROP TABLE, RENAME) rompe il codice rimesso
 * online. Da qui in avanti una migrazione così passa solo col marcatore
 * `-- contract: colonna non letta dal codice dal rilascio <sha>` (prima si smette di leggerla, poi,
 * in un rilascio dopo, si toglie).
 *
 * Vale per le migrazioni con numero più alto di ULTIMA_GIA_SCRITTA: le vecchie (105, 134…) sono già
 * applicate e non si riscrivono.
 */
export const ULTIMA_GIA_SCRITTA = 195;
const DISTRUTTIVA = /\b(DROP\s+COLUMN|DROP\s+TABLE|RENAME\s+(COLUMN\s+)?\w+\s+TO|ALTER\s+TABLE\s+\S+\s+RENAME)\b/i;
const MARCATORE = /^--\s*contract:\s*colonna non letta dal codice dal rilascio\s+[0-9a-f]{7,}/im;

export function migrazioniDistruttiveSenzaMarcatore(cartella: string, dalNumero = ULTIMA_GIA_SCRITTA + 1): string[] {
  return readdirSync(cartella)
    .filter((f) => /^\d+_.*\.sql$/.test(f) && Number(f.split('_')[0]) >= dalNumero)
    .filter((f) => {
      const testo = readFileSync(join(cartella, f), 'utf8');
      const senzaCommenti = testo.split('\n').filter((r) => !/^\s*--/.test(r)).join('\n');
      return DISTRUTTIVA.test(senzaCommenti) && !MARCATORE.test(testo);
    });
}

describe('le migrazioni nuove non tolgono niente senza il marcatore', () => {
  it('nessuna migrazione nuova con DROP o RENAME senza «-- contract:»', () => {
    expect(migrazioniDistruttiveSenzaMarcatore(join(process.cwd(), 'migrations'))).toEqual([]);
  });

  it('la regola vede davvero un DROP COLUMN (e lascia passare quello col marcatore)', () => {
    const cartella = join(process.cwd(), 'tests/unit/aiuti/migrazioni-di-prova-s03');
    expect(migrazioniDistruttiveSenzaMarcatore(cartella, 900)).toEqual(['901_toglie_una_colonna.sql']);
  });
});
