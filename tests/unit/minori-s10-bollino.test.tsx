import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { VerifiedBadge } from '@/components/ui/VerifiedBadge';

/**
 * S10 (5/11/2026, scheda 227) — il bollino «Negozio verificato» ha un nome
 * che i lettori di schermo leggono (testo, non aria-label su uno span).
 */
describe('il bollino verificato si legge (227)', () => {
  it('senza etichetta visibile: testo sr-only, niente aria-label su span', () => {
    const html = renderToStaticMarkup(createElement(VerifiedBadge));
    expect(html).toMatch(/<span class="sr-only">Negozio verificato<\/span>/);
    expect(html).not.toMatch(/<span[^>]*aria-label=/);
  });
  it('con etichetta: «Verificato» resta visibile', () => {
    const html = renderToStaticMarkup(createElement(VerifiedBadge, { showLabel: true }));
    expect(html).toMatch(/Verificato/);
  });
});
