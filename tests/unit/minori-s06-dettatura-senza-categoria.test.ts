import { describe, it, expect } from 'vitest';
import { esitoDelPiano, pianoPatchPerIlModulo } from '@/lib/products/aiPatch';
import { avvisoDopoLaDettatura } from '@/lib/products/avvisoDellaDettatura';

/**
 * S06 · 1701 — Prodotto nuovo senza categoria: dopo la dettatura resta la frase
 * che ricorda di scrivere allergeni e ingredienti.
 */
const CATEGORIE = [{ id: 'alim', name: 'Alimentari', slug: 'alimentari', parent_id: null }];
describe('1701 — dettatura senza categoria', () => {
  it('la frase generica compare', () => {
    const piano = pianoPatchPerIlModulo({ name: 'Biscotti al burro', price: 4 } as never, {
      prezzoAttuale: null, categorie: CATEGORIE as never, categoriaAttuale: '', modo: 'create',
    });
    const a = avvisoDopoLaDettatura({ esito: esitoDelPiano(piano), dettato: 'biscotti al burro contengono latte', risposta: 'Fatto' });
    expect(a.dichiarazioni).toMatch(/allergeni e ingredienti non li scrive l'assistente/);
  });
  it('con la categoria resta la frase con i campi della categoria', () => {
    const piano = pianoPatchPerIlModulo({ name: 'Biscotti', category_slug: 'alimentari' } as never, {
      prezzoAttuale: null, categorie: CATEGORIE as never, categoriaAttuale: '', modo: 'create',
    });
    const a = avvisoDopoLaDettatura({ esito: esitoDelPiano(piano), dettato: 'biscotti', risposta: '' });
    expect(a.dichiarazioni).toMatch(/^Allergeni/);
  });
});
