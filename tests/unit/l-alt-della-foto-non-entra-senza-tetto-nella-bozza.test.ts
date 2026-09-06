import { describe, it, expect } from 'vitest';
import {
  buildDraftProductInsert,
  MAX_ALT_TEXT,
  MAX_VALORE_ATTRIBUTO,
} from '@/lib/products/draftFromVision';

/**
 * 6/9/2026 — IL TESTO ALTERNATIVO DELLA FOTO ENTRAVA NELLA BOZZA SENZA NESSUN
 * TETTO DI LUNGHEZZA.
 *
 * Il 30/8 (R158) nome e descrizione hanno preso un tetto condiviso: 120 e 4000
 * caratteri. L'alt della foto e i valori testuali degli attributi no — venivano
 * copiati così com'erano dentro `products.attributes`, che è una colonna JSONB,
 * e il corpo della richiesta può arrivare a un megabyte. Una sola bozza poteva
 * portarsi dietro un megabyte di JSON: pesa su ogni lettura del catalogo del
 * venditore e su ogni esportazione, e quando l'alt finirà nell'HTML pubblico —
 * che è il suo mestiere — la pagina del prodotto peserà un megabyte.
 */

const CATEGORIE = [
  { id: 'cat-1', name: 'Casa', slug: 'casa', parent_id: null },
];

function bozza(draft: Record<string, unknown>) {
  return buildDraftProductInsert({
    draft: draft as never,
    imageUrls: ['https://mycity.test/foto.jpg'],
    categories: CATEGORIE as never,
    sellerId: 'seller-1',
  });
}

describe('nella bozza non entra testo senza tetto', () => {
  it("l'alt della foto viene tagliato", () => {
    const enorme = 'a'.repeat(200_000);
    const out = bozza({ name: 'Lampada', category_id: 'cat-1', alt_text: enorme });
    const alt = String((out.attributes as Record<string, string>).alt_text ?? '');
    expect(
      alt.length,
      'duecentomila caratteri di alt finiscono interi in products.attributes: la bozza si porta dietro un megabyte di JSON',
    ).toBeLessThanOrEqual(MAX_ALT_TEXT);
    expect(alt.length).toBeGreaterThan(0);
  });

  it('un alt normale resta intero', () => {
    const out = bozza({ name: 'Lampada', category_id: 'cat-1', alt_text: 'lampada accesa sul comodino' });
    expect((out.attributes as Record<string, string>).alt_text).toBe('lampada accesa sul comodino');
  });

  it('anche i valori testuali degli attributi hanno un tetto', () => {
    // `materiale` è un campo testo dello schema comune a tutte le categorie.
    const out = bozza({
      name: 'Lampada',
      category_id: 'cat-1',
      attributes: { materiale: 'b'.repeat(200_000) },
    });
    const attributi = out.attributes as Record<string, string>;
    for (const [chiave, valore] of Object.entries(attributi)) {
      expect(
        valore.length,
        `l'attributo «${chiave}» entra senza tetto in una colonna JSONB`,
      ).toBeLessThanOrEqual(MAX_VALORE_ATTRIBUTO);
    }
  });
});
