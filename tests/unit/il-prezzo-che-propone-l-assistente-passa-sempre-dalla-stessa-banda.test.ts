import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveAiPatch, patchAiPerIlForm, BANDA_PREZZO_AI } from '@/lib/products/aiPatch';

/**
 * 27/8/2026 (R145) — LA BANDA SUL PREZZO ESISTEVA SOLO SULLA STRADA CHE QUASI
 * NESSUNO PRENDE.
 *
 * Il freno c'era, ma su una strada sola. `resolveAiPatch` — il pezzo che gira
 * sul server — rifiuta un prezzo proposto dall'assistente che si scosti di più
 * del 30% da quello attuale, e lo dice. Ma i suggerimenti di «Migliora tutto»,
 * della diagnosi, della chat sul prodotto, del testo per Google, della
 * traduzione e del codice a barre non passano di lì: tornano al browser e li
 * applica il modulo del prodotto, che sul prezzo non guardava niente.
 *
 * Lo zero perso dal modello — 20 € che diventano 2 € — entrava in vetrina se il
 * negoziante premeva «applica» e salvava senza rileggere il campo prezzo. E il
 * salvataggio del modulo scrive dritto sul database, quindi non c'era nemmeno
 * un secondo controllo dietro.
 *
 * Adesso la banda è una sola funzione, e la usano tutte e due le strade.
 */

const CATEGORIE = [{ id: 'c1', name: 'Gastronomia', slug: 'gastronomia', parent_id: null }];

describe('la banda del 30% sul prezzo proposto dall assistente', () => {
  it('lo zero perso dal modello non entra in vetrina, ne dal server ne dal browser', () => {
    // Il caso vero: un prodotto da 20 €, il modello propone 2 €.
    const dalServer = resolveAiPatch({
      patch: { price: 2 },
      current: { attributes: null, category_id: 'c1', price: 20 },
      categories: CATEGORIE,
    });
    const dalBrowser = patchAiPerIlForm({ price: 2 }, { prezzoAttuale: 20 });

    expect(dalServer.update.price, 'il server ha scritto un prezzo che nessuno ha deciso').toBeUndefined();
    expect(
      dalBrowser.patch.price,
      'nel modulo del prodotto il prezzo sbagliato ci finisce lo stesso: il negoziante salva 2 € al posto di 20 €',
    ).toBeUndefined();
    expect(dalBrowser.rifiutati.length, 'il prezzo viene scartato in silenzio, senza dirlo a chi guarda').toBe(1);
  });

  it('un ritocco dentro la banda passa da tutte e due le parti', () => {
    // 20 € → 24 €: è il +20%, sotto la soglia. Qui il freno non deve impicciarsi.
    const dalServer = resolveAiPatch({
      patch: { price: 24 },
      current: { attributes: null, category_id: 'c1', price: 20 },
      categories: CATEGORIE,
    });
    const dalBrowser = patchAiPerIlForm({ price: 24 }, { prezzoAttuale: 20 });

    expect(dalServer.update.price).toBe(24);
    expect(dalBrowser.patch.price, 'un ritocco onesto viene bloccato: il freno da fastidio invece di servire').toBe(24);
    expect(dalBrowser.rifiutati).toEqual([]);
  });

  it('le due strade si fermano allo stesso centesimo', () => {
    // Il difetto vero è la DIVERGENZA: due soglie diverse tornano a divergere.
    const attuale = 20;
    for (const proposto of [12, 13.9, 14, 14.1, 25.9, 26, 26.1, 30]) {
      const server = resolveAiPatch({
        patch: { price: proposto },
        current: { attributes: null, category_id: 'c1', price: attuale },
        categories: CATEGORIE,
      });
      const browser = patchAiPerIlForm({ price: proposto }, { prezzoAttuale: attuale });
      expect(
        browser.patch.price !== undefined,
        `su ${attuale} € → ${proposto} € il server e il browser decidono in modo diverso`,
      ).toBe(server.update.price !== undefined);
    }
  });

  it('il rifiuto dice quale prezzo c era e quale e stato proposto', () => {
    const { rifiutati } = patchAiPerIlForm({ price: 2 }, { prezzoAttuale: 20 });
    expect(rifiutati[0]).toContain('20.00');
    expect(rifiutati[0]).toContain('2.00');
  });

  it('su un prodotto nuovo, senza prezzo di partenza, la banda non si inventa niente', () => {
    const { patch, rifiutati } = patchAiPerIlForm({ price: 9.9 }, { prezzoAttuale: null });
    expect(patch.price, 'il primo prezzo di un prodotto nuovo viene rifiutato per niente').toBe(9.9);
    expect(rifiutati).toEqual([]);
  });

  it('la banda resta quella dichiarata: 30%', () => {
    expect(BANDA_PREZZO_AI).toBe(0.3);
  });

  it('gli altri campi del suggerimento passano intatti', () => {
    const { patch } = patchAiPerIlForm(
      { price: 2, name: 'Focaccia di Recco', tags: ['forno'] },
      { prezzoAttuale: 20 },
    );
    expect(patch.name, 'insieme al prezzo si perde anche il resto del suggerimento').toBe('Focaccia di Recco');
    expect(patch.tags).toEqual(['forno']);
  });
});

/**
 * Il freno strutturale: se il modulo del prodotto torna a leggere il prezzo dal
 * suggerimento grezzo, la banda smette di valere e nessun test lo vedrebbe.
 */
describe('il modulo del prodotto non tocca il prezzo prima del filtro', () => {
  it('applyPatch fa passare il suggerimento da patchAiPerIlForm', () => {
    const form = readFileSync('components/seller/ProductForm.tsx', 'utf8');
    expect(
      form.includes('patchAiPerIlForm('),
      'il modulo applica i suggerimenti dell assistente senza nessuna banda sul prezzo',
    ).toBe(true);
  });
});
