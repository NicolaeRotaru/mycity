/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { vaiAlPrimoBlocco } from '@/components/checkout/OrderSummary';

describe('S07 · col pulsante bloccato si va sul motivo vero', () => {
  it('salta l’avviso «il prezzo è cambiato» (informativo) e va sul blocco', () => {
    document.body.innerHTML = `
      <div role="alert" data-informativo id="prezzo">Il prezzo è cambiato</div>
      <div role="alert" id="varianti">Scegli le opzioni</div>`;
    Element.prototype.scrollIntoView = () => undefined;
    expect(vaiAlPrimoBlocco()).toBe(true);
    expect(document.activeElement?.id).toBe('varianti');
  });
  it('con soli avvisi informativi non dice di aver spiegato qualcosa', () => {
    document.body.innerHTML = `<div role="alert" data-informativo>Il prezzo è cambiato</div>`;
    expect(vaiAlPrimoBlocco()).toBe(false);
  });
  it('gli avvisi che non bloccano sono segnati come informativi in cassa e nel carrello', () => {
    const cassa = readFileSync('app/checkout/page.tsx', 'utf8');
    expect(cassa).toMatch(/prezziCambiati\.length > 0 && \(\s*<div role="alert" data-informativo/);
    expect(cassa).toMatch(/orphans\.length > 0 && \(\s*<div role="alert" data-informativo/);
    expect(readFileSync('app/cart/page.tsx', 'utf8')).toMatch(/<p role="alert" data-informativo[^>]*>\s*\{motivoFuoriZona\(g\.storeName\)\}/);
  });
});
