import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 6/9/2026 — «SCARICA I MIEI DATI» SALTAVA VENTICINQUE TABELLE.
 *
 * L'export leggeva venti tabelle scritte a mano dentro la rotta. Nel database
 * ce n'erano altre venticinque con un legame verso la persona che non leggeva
 * nessuno: il credito del portafoglio, i punti fedeltà, i buoni regalo, le
 * domande scritte sui prodotti, gli SOS del fattorino.
 *
 * La causa non era la distrazione di qualcuno: era che l'elenco viveva solo
 * dentro la rotta e si aggiornava a memoria. Ogni tabella nuova nasceva fuori
 * dall'export, e nessuno se ne accorgeva finché non arrivava una richiesta.
 *
 * Questa prova è il freno. Legge le migrazioni, trova ogni tabella con una
 * chiave verso `profiles` o `auth.users`, e pretende che sia nominata
 * nell'export oppure che stia qui sotto con scritto PERCHÉ non ci va. Una
 * tabella nuova che nasce fuori dall'export rende rossa questa prova, non una
 * richiesta di un cliente sei mesi dopo.
 */

const ROTTA = join(process.cwd(), 'app/api/account/export/route.ts');
const MIGRAZIONI = join(process.cwd(), 'migrations');

/**
 * Le tabelle che hanno un legame con una persona ma NON sono dati personali
 * da restituire. Ognuna col suo motivo: se domani il motivo non regge più, si
 * toglie da qui e si aggiunge all'export.
 */
const FUORI_DALL_EXPORT: Record<string, string> = {
  profiles: 'è il profilo stesso: esce già come «profile»',
  products: 'catalogo del negozio, non dati della persona: esce dagli ordini',
  site_settings: 'impostazioni del sito, il legame è chi le ha modificate',
  cms_pages: 'pagine pubbliche del sito',
  marketplace_events: 'eventi pubblici del marketplace',
  shop_of_month: 'classifica pubblica del negozio del mese',
  daily_stories: 'contenuti pubblici della vetrina',
  seller_stories: 'contenuti pubblici della vetrina',
  sponsored_listings: 'spazi pubblicitari comprati dal negozio: dato commerciale',
  seller_promotions: 'promozioni pubbliche del negozio',
  audit_logs: 'registro di controllo: va conservato e non si esporta a richiesta',
  cod_reconciliations: 'quadratura della cassa contanti: registro contabile',
  catalog_ai_jobs: 'lavorazioni tecniche del catalogo, non dati della persona',
  invoice_sequences: 'contatore del numero di fattura, non un dato della persona',
};

/** Ogni tabella creata nelle migrazioni che punta a una persona. */
function tabelleConDatiDiPersone(): string[] {
  const versoPersona = /references\s+(?:public\.)?(?:profiles|auth\.users)\s*\(\s*id\s*\)/i;
  const apertura = /create table(?:\s+if not exists)?\s+(?:public\.)?([a-z_0-9]+)\s*\(/gi;
  const trovate = new Set<string>();

  for (const file of readdirSync(MIGRAZIONI).filter((f) => f.endsWith('.sql'))) {
    const sql = readFileSync(join(MIGRAZIONI, file), 'utf8');
    let m: RegExpExecArray | null;
    apertura.lastIndex = 0;
    while ((m = apertura.exec(sql)) !== null) {
      // Il corpo della tabella: dalla parentesi aperta alla sua chiusura.
      let profondita = 1;
      let i = m.index + m[0].length;
      while (i < sql.length && profondita > 0) {
        if (sql[i] === '(') profondita++;
        else if (sql[i] === ')') profondita--;
        i++;
      }
      if (versoPersona.test(sql.slice(m.index + m[0].length, i))) trovate.add(m[1]);
    }
  }
  return [...trovate].sort();
}

describe('l export dei dati personali non salta nessuna tabella', () => {
  const rotta = readFileSync(ROTTA, 'utf8');
  const tabelle = tabelleConDatiDiPersone();

  it('le migrazioni si leggono davvero (la prova non passa a vuoto)', () => {
    expect(tabelle.length).toBeGreaterThan(40);
    expect(tabelle).toContain('wallet_ledger');
  });

  it('ogni tabella con dati di una persona è nell export, o è esclusa con un motivo', () => {
    const dimenticate = tabelle.filter(
      (t) => !FUORI_DALL_EXPORT[t] && !rotta.includes(`from('${t}')`),
    );
    expect(
      dimenticate,
      'queste tabelle contengono dati di una persona e «scarica i miei dati» non le legge: ' +
        'chi esercita il diritto di accesso riceve una risposta incompleta',
    ).toEqual([]);
  });

  it('nessuna esclusione senza motivo scritto', () => {
    for (const [tabella, motivo] of Object.entries(FUORI_DALL_EXPORT)) {
      expect(motivo.length, `${tabella} è esclusa senza dire perché`).toBeGreaterThan(20);
    }
  });

  it('le esclusioni parlano di tabelle che esistono ancora', () => {
    const fantasmi = Object.keys(FUORI_DALL_EXPORT).filter((t) => !tabelle.includes(t));
    expect(fantasmi, 'esclusioni rimaste da tabelle che non esistono più: ripulire').toEqual([]);
  });
});
