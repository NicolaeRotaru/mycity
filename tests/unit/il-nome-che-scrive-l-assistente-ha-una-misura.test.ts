import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  resolveAiPatch,
  MAX_NOME_PRODOTTO,
  MAX_DESCRIZIONE_PRODOTTO,
  type CategoryRow,
} from '@/lib/products/aiPatch';

/**
 * 30/8/2026 (R158) — CHI CREAVA TAGLIAVA, CHI MODIFICAVA NO.
 *
 * La bozza da foto tronca da sempre: nome a 120 caratteri, descrizione a 4000
 * (`draftFromVision`). `resolveAiPatch` — la strada che MODIFICA un prodotto
 * che esiste gia' — accettava qualunque lunghezza col solo controllo «stringa
 * non vuota», e la scriveva dritta nel database, dove `name text` e
 * `description text` non avevano nessun vincolo. Un nome di diecimila
 * caratteri appesantisce elenchi, ricerca, email e pagina pubblica del
 * negozio, e non c'era niente che lo impedisse da nessuna delle due strade.
 *
 * Le due misure adesso vivono in un posto solo e le usano tutte e due le
 * strade: se qualcuno le cambia in una sola, questa prova diventa rossa.
 */

const categories: CategoryRow[] = [
  { id: 'top-food', name: 'Alimentari', slug: 'alimentari', parent_id: null },
];
const current = { attributes: {}, category_id: 'top-food', has_variants: false };

describe('la misura del nome e della descrizione che scrive l assistente', () => {
  it('taglia un nome piu lungo del massimo invece di scriverlo intero', () => {
    const enorme = 'Pane di Altamura '.repeat(500); // ~8500 caratteri
    const { update } = resolveAiPatch({ patch: { name: enorme }, current, categories });
    expect(
      String(update.name).length,
      `Un nome da ${enorme.length} caratteri finiva tale e quale in vetrina, nelle email e nei risultati di ricerca`,
    ).toBe(MAX_NOME_PRODOTTO);
  });

  it('taglia una descrizione piu lunga del massimo', () => {
    const enorme = 'x'.repeat(9000);
    const { update } = resolveAiPatch({ patch: { description: enorme }, current, categories });
    expect(String(update.description).length).toBe(MAX_DESCRIZIONE_PRODOTTO);
  });

  it('un nome di misura normale non viene toccato', () => {
    const { update } = resolveAiPatch({
      patch: { name: '  Focaccia alle olive  ' },
      current,
      categories,
    });
    expect(update.name).toBe('Focaccia alle olive');
  });

  it('le due strade — chi crea e chi modifica — usano lo stesso numero', () => {
    // `draftFromVision` scriveva 120 e 4000 a mano. Se una delle due si sposta
    // senza l'altra, il taglio smette di essere lo stesso e il difetto torna
    // meta' aperto.
    const src = readFileSync(join(process.cwd(), 'lib/products/draftFromVision.ts'), 'utf8');
    expect(src).toContain('MAX_NOME_PRODOTTO');
    expect(src).toContain('MAX_DESCRIZIONE_PRODOTTO');
  });

  it('il vincolo esiste anche nel database, perche la pagina di modifica scrive diretta', () => {
    // La scheda del negoziante scrive su Supabase senza passare da qui: senza
    // il vincolo sulla tabella il limite varrebbe solo per una delle due porte.
    const dir = join(process.cwd(), 'migrations');
    const sql = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => readFileSync(join(dir, f), 'utf8'))
      .join('\n');
    expect(sql).toMatch(/products_name_lunghezza/);
    expect(sql).toMatch(/products_description_lunghezza/);
  });
});
