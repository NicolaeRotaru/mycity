import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { senzaCommenti } from '@/scripts/gen-db-types.mjs';

/**
 * 31/8/2026 — IL GENERATORE DEI TIPI ESEGUIVA I COMMENTI, E PERDEVA COLONNE.
 *
 * In questa casa una migrazione documenta come si torna indietro. La 148 scrive,
 * in un commento: «REVERSIBILE: ALTER TABLE ... DROP COLUMN recovered_at;».
 * Il generatore non toglieva i commenti, quindi leggeva quella riga come codice:
 * aggiungeva la colonna dall'ALTER vero e la cancellava dal commento. Nei tipi
 * spariva, senza un errore e senza un avviso.
 *
 * Il danno vero non e' il tipo mancante: e' che il file committato smetteva di
 * combaciare con le migrazioni, e in CI il lavoro «I tipi del database sono
 * aggiornati» diventava rosso per una colonna che nessuno aveva toccato. Piu' si
 * documentava bene il rollback, piu' colonne sparivano.
 */

describe('il generatore dei tipi davanti ai commenti', () => {
  it('non esegue un rollback scritto dentro un commento', () => {
    const migrazione = [
      'ALTER TABLE public.abandoned_carts',
      '    ADD COLUMN IF NOT EXISTS recovered_at timestamptz;',
      '-- REVERSIBILE: `ALTER TABLE public.abandoned_carts DROP COLUMN recovered_at;`',
    ].join('\n');

    const pulita = senzaCommenti(migrazione);

    expect(
      pulita,
      'la colonna aggiunta davvero deve restare: e la riga di codice vera',
    ).toContain('ADD COLUMN IF NOT EXISTS recovered_at');
    expect(
      pulita,
      'il rollback documentato nel commento e stato letto come codice: la colonna sparisce dai tipi senza che nessuno la tolga',
    ).not.toContain('DROP COLUMN recovered_at');
  });

  it('toglie anche i commenti a blocco', () => {
    const pulita = senzaCommenti('CREATE TABLE a (id int);\n/* ALTER TABLE a DROP COLUMN id; */\n');
    expect(pulita).toContain('CREATE TABLE a');
    expect(pulita, 'un commento a blocco resta leggibile come codice').not.toContain('DROP COLUMN');
  });

  it("un doppio trattino dentro una stringa non e un commento, e non si cancella", () => {
    const sql = "INSERT INTO note (testo) VALUES ('sconto -- meta prezzo');";
    expect(
      senzaCommenti(sql),
      'il testo dentro le virgolette e dato, non codice: tagliarlo cambia quello che la migrazione scrive davvero',
    ).toContain('sconto -- meta prezzo');
  });

  it('un corpo di funzione fra $$ resta intero, commenti compresi', () => {
    const sql = "CREATE FUNCTION f() RETURNS void AS $$\nBEGIN\n  -- questo resta\n  PERFORM 1;\nEND;\n$$ LANGUAGE plpgsql;";
    expect(senzaCommenti(sql)).toContain('-- questo resta');
  });

  it('la migrazione VERA 148 non perde la sua colonna', () => {
    const vera = readFileSync('migrations/148_carrelli_recuperati.sql', 'utf8');
    const pulita = senzaCommenti(vera);
    expect(pulita).toContain('ADD COLUMN IF NOT EXISTS recovered_at');
    expect(
      pulita,
      'la 148 documenta il proprio rollback: se quel commento sopravvive, il generatore cancella recovered_at',
    ).not.toContain('DROP COLUMN recovered_at');
  });
});
