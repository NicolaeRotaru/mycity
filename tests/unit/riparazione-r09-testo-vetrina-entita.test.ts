import { describe, it, expect } from 'vitest';
import { aCapoInHtml, htmlInACapo } from '@/components/seller/site/SectionConfigForm';
import { sanitizeRichText } from '@/lib/sanitize-html';

/**
 * R09-009 — Dopo il salvataggio il blocco di testo mostrava «Pane &amp; vino»: la pulizia
 * salva le entità, il campo le doveva decodificare. Andata (si scrive, si salva) e ritorno
 * (si rilegge) devono ridare lo stesso testo.
 */
const giro = (testo: string) => htmlInACapo(sanitizeRichText(aCapoInHtml(testo)));

describe('R09-009 — il testo salvato si rilegge com\'era scritto', () => {
  it('«&» e «<» tornano com\'erano, con l\'a-capo che li ha messi in mezzo', () => {
    expect(giro('Pane & vino\nsale < zucchero > acqua')).toBe('Pane & vino\nsale < zucchero > acqua');
  });
  it('anche scritto come entità resta com\'è scritto', () => {
    expect(giro('Tom &amp; Jerry &lt;3')).toBe('Tom &amp; Jerry &lt;3');
  });
  it('un «<b>» scritto non diventa un tag salvato', () => {
    expect(sanitizeRichText(aCapoInHtml('<b>forte</b>'))).not.toContain('<b>');
    expect(giro('<b>forte</b>')).toBe('<b>forte</b>');
  });
  it('il campo mostra il carattere vero di quello che è già salvato', () => {
    expect(htmlInACapo('Pane &amp; vino<br>caldo &lt; freddo')).toBe('Pane & vino\ncaldo < freddo');
  });
  it('il testo senza simboli si salva identico a prima', () => {
    expect(aCapoInHtml('Pane fresco\nogni mattina')).toBe('Pane fresco<br>ogni mattina');
  });
});
