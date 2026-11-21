import { describe, it, expect } from 'vitest';
import { aCapoInHtml, htmlInACapo } from '@/components/seller/site/SectionConfigForm';
import { sanitizeRichText } from '@/lib/sanitize-html';

describe('testo della vetrina: salvato e riletto', () => {
  it('un testo con & e < si rilegge nel campo senza entità', () => {
    const scritto = 'Pane & latte\nsotto 5 < 10 euro';
    const salvato = sanitizeRichText(aCapoInHtml(scritto));
    expect(salvato).toContain('&amp;');
    expect(htmlInACapo(salvato)).toBe(scritto);
  });
});

describe('testo della vetrina: giro salva, rileggi, salva, rileggi', () => {
  const casi = ['Pane & latte', '5 < 10', 'AT&T <3', 'a &amp; b', '&lt;b&gt;', 'riga1\nriga2', 'x > y & z < w\n&amp;lt;'];
  for (const scritto of casi) {
    it(`resta identico e stabile: ${JSON.stringify(scritto)}`, () => {
      let campo = scritto;
      let salvato = '';
      for (let giro = 0; giro < 3; giro++) {
        salvato = sanitizeRichText(aCapoInHtml(campo));
        campo = htmlInACapo(salvato);
        expect(campo).toBe(scritto);
      }
      // niente entità doppie nell'HTML reso, e nessun tag vero nato dal testo
      expect(salvato).not.toMatch(/&amp;amp;amp;/);
      expect(salvato.replace(/<br>/g, '')).not.toMatch(/<(?!\/?br)/);
    });
  }
  it('il testo «a &amp; b» scritto a lettere si vede a lettere nella pagina', () => {
    expect(sanitizeRichText(aCapoInHtml('a &amp; b'))).toBe('a &amp;amp; b');
  });
});
