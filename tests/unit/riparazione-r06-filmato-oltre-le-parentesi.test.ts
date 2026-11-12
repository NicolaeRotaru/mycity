/**
 * R06-018 (12/11/2026) — IL FILTRO DEL FILMATO SI FERMAVA ALLA PRIMA PARENTESI.
 *
 * La rete che toglie i dati personali cercava gli indirizzi con un'espressione
 * che considerava «(» e «)» un confine. La barra di ricerca costruisce
 * /search?q= con encodeURIComponent, che le parentesi non le codifica (e
 * nemmeno ! * ~ '): per la ricerca «pane (mario.rossi@gmail.com)» usciva
 * «/search?q=***(mario.rossi%40gmail.com)».
 */
import { describe, it, expect } from 'vitest';
import { testoSenzaIndirizzi, strutturaSenzaIndirizzi } from '@/lib/analytics/filmato-senza-dati-personali';

const ricerca = (q: string) => `/search?q=${encodeURIComponent(q)}`;

describe('R06-018 · il filtro guarda oltre le parentesi', () => {
  it('«pane (mario.rossi@gmail.com)» non esce in chiaro, ne\' intero ne\' relativo', () => {
    for (const testo of [
      `https://mycity.it${ricerca('pane (mario.rossi@gmail.com)')}`,
      ricerca('pane (mario.rossi@gmail.com)'),
    ]) {
      const pulito = testoSenzaIndirizzi(testo);
      expect(pulito, `uscito in chiaro: ${pulito}`).not.toMatch(/mario|rossi|gmail/i);
      expect(pulito).toContain('/search?q=');
    }
  });

  for (const segno of ['(', ')', '!', '*', '~', "'"]) {
    it(`il segno ${segno} non ferma la pulizia`, () => {
      const pulito = testoSenzaIndirizzi(ricerca(`pane${segno}3331234567`));
      expect(pulito, `uscito in chiaro: ${pulito}`).not.toContain('3331234567');
    });
  }

  it('il link cliccato fra le ricerche recenti ($elements) esce pulito', () => {
    const elementi = [{ tag_name: 'a', attr__href: ricerca('pane (mario.rossi@gmail.com)') }];
    const pulito = JSON.stringify(strutturaSenzaIndirizzi(elementi));
    expect(pulito).not.toMatch(/mario|rossi|gmail/i);
  });

  it('un percorso senza parametri resta com\'e\'', () => {
    expect(testoSenzaIndirizzi('/product/abc')).toBe('/product/abc');
  });

  it('un nome dopo l\'apostrofo non esce in chiaro (senza numeri che la rete dei telefoni prenderebbe)', () => {
    for (const q of ["Orto'Mario Bianchi", 'pane!Giulia', 'torta*Verdi', 'pane~Rossi']) {
      const pulito = testoSenzaIndirizzi(ricerca(q));
      expect(pulito, `uscito in chiaro: ${pulito}`).not.toMatch(/Mario|Giulia|Verdi|Rossi/);
    }
  });
});
