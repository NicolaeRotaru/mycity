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
  const casi = ['Pane & latte', '5 < 10', 'AT&T <3', 'a &amp; b', '&lt;b&gt;', 'riga1\nriga2', 'x > y & z < w\n&amp;lt;', 'a\u00a0b\nc', '&nbsp;', 'a &nbsp; b\nc', '&amp;nbsp;\nx'];
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

describe('testo della vetrina: spazio non separabile e entità scritte a lettere', () => {
  it('«a<nbsp>b\\nc» salvato, riletto e risalvato resta identico', () => {
    const scritto = 'a\u00a0b\nc';
    const salvato = sanitizeRichText(aCapoInHtml(scritto));
    const campo = htmlInACapo(salvato);
    expect(campo).toBe(scritto);
    expect(sanitizeRichText(aCapoInHtml(campo))).toBe(salvato);
    expect(salvato).not.toContain('&amp;nbsp;');
  });
  it('«&nbsp;» scritto a lettere dal negoziante torna a lettere', () => {
    const scritto = 'a &nbsp; b\nc';
    expect(htmlInACapo(sanitizeRichText(aCapoInHtml(scritto)))).toBe(scritto);
  });
  it('le altre entità si decodificano in un solo passaggio', () => {
    expect(htmlInACapo('&quot;x&quot; &#39;y&#39; &apos;z&apos; &#65;&#x42; &amp;quot; &amp;#65;')).toBe(
      '"x" \'y\' \'z\' AB &quot; &#65;',
    );
  });
});
