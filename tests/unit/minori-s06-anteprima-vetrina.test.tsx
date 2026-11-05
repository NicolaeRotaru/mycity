import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import SitePreview from '@/components/seller/site/SitePreview';

/** S06 · 363 — L'anteprima della vetrina non inventa indirizzo web né orari. */
describe('363 — anteprima vera', () => {
  it('niente «mycity.it/negozio/…» e niente «Lun–Sab 8:00–19:30»', () => {
    const page = { id: 'h', title: 'Home', slug: '', visibility: 'public', sections: [{ id: 's1', type: 'hours', enabled: true, config: {} }] };
    const html = renderToStaticMarkup(
      <SitePreview page={page as never} theme={'classico' as never} accent="#C0492C" storeName="Pane Quotidiano" storeSlug="pane-quotidiano" />,
    );
    expect(html).not.toContain('mycity.it/negozio');
    expect(html).not.toContain('Lun–Sab 8:00–19:30');
    expect(html).toContain('Dettagli negozio');
  });
});
