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
