import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { aCapoInHtml, htmlInACapo } from '@/components/seller/site/SectionConfigForm';
import { sanitizeRichText } from '@/lib/sanitize-html';

/**
 * S06 — Testi e colore del costruttore della vetrina.
 * 323: l'a-capo del blocco di testo arriva sulla pagina vera; niente promessa del grassetto.
 * 328: logo, copertina, orari ed evidenza rimandano ai Dettagli negozio, non al Profilo.
 * 322: il colore del negozio si cambia in un posto solo.
 */
describe('323 — a-capo nel testo della vetrina', () => {
  it('l\'a-capo diventa <br>, che la pulizia lascia passare, e nel campo torna a-capo', () => {
    const body = aCapoInHtml('Pane fresco\nogni mattina');
    expect(sanitizeRichText(body)).toBe('Pane fresco<br>ogni mattina');
    expect(htmlInACapo(body)).toBe('Pane fresco\nogni mattina');
  });
  it('l\'aiuto non promette il grassetto', () => {
    expect(readFileSync('components/seller/site/SectionConfigForm.tsx', 'utf8')).not.toContain('Puoi usare grassetto');
  });
});

describe('328 — rimandi giusti', () => {
  it('niente «Profilo negozio» nel costruttore', () => {
    const s = readFileSync('components/seller/site/SectionConfigForm.tsx', 'utf8');
    expect(s).not.toMatch(/da Profilo negozio|>Profilo negozio</);
    expect(s).toContain('href="/seller/site?details=1"');
  });
});

describe('322 — un posto solo per il colore', () => {
  it('il selettore del tema nell\'editor non salva il colore', () => {
    expect(readFileSync('components/seller/site/SiteEditor.tsx', 'utf8'))
      .toMatch(/<ThemePicker value=\{site\.theme\} onChange=\{\(theme\) => commit\(\{ \.\.\.site, theme \}\)\} \/>/);
  });
});
