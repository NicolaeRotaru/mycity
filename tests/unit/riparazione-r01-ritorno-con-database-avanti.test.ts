import { describe, it, expect } from 'vitest';
import { esegui, passo, SEGRETI_FINTI } from './_lavoro-di-rilascio';

/**
 * R01-015 — Se il sito nuovo non risponde si torna indietro col codice, ma il database resta
 * avanti. Il riepilogo diceva solo «apri quelle migrazioni e guarda se contengono DROP o RENAME».
 * Adesso il passo le guarda da se' e nomina quelle che tolgono qualcosa.
 *
 * Quello che resta (migrazioni «espandi e poi contrai», o niente ritorno automatico quando una
 * migrazione toglie qualcosa) e' una scelta di Nicola.
 */
const PASSO = 'Torna indietro, il sito appena pubblicato non risponde';

describe('R01-015 · il ritorno indietro nomina le migrazioni che tolgono qualcosa', () => {
  it('con la 105 (DROP TABLE) fra quelle applicate, il riepilogo la nomina con la riga', () => {
    const e = esegui(passo(PASSO), {
      env: {
        ...SEGRETI_FINTI,
        PRECEDENTE: 'https://mycity-quello-di-prima.vercel.app',
        MIGRAZIONI: '2',
        MIGRAZIONI_ELENCO: '095_cron_heartbeats.sql 105_remove_invoicing.sql ',
      },
    });
    expect(e.riepilogo).toMatch(/TOLGONO o RINOMINANO/);
    expect(e.riepilogo).toMatch(/105_remove_invoicing\.sql`: riga \d+: DROP TABLE/);
    expect(e.riepilogo).not.toMatch(/095_cron_heartbeats\.sql`:/);
  });

  it('con sole migrazioni che aggiungono, lo dice', () => {
    const e = esegui(passo(PASSO), {
      env: {
        ...SEGRETI_FINTI,
        PRECEDENTE: 'https://mycity-quello-di-prima.vercel.app',
        MIGRAZIONI: '1',
        MIGRAZIONI_ELENCO: '095_cron_heartbeats.sql',
      },
    });
    expect(e.riepilogo).toMatch(/nessuna contiene DROP COLUMN, DROP TABLE o RENAME/);
  });
});
