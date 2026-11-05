import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// Il ritiro in negozio acceso: la pagina Spedizioni mostra la quarta card.
vi.mock('@/lib/ritiro-in-negozio', () => ({ RITIRO_IN_NEGOZIO_ATTIVO: true }));

import ShippingPage from '@/app/shipping/page';

describe('S07 · /shipping col ritiro acceso', () => {
  const html = renderToStaticMarkup(<ShippingPage />);
  it('le quattro card stanno in una griglia da due, non da tre con l\'ultima sola', () => {
    expect(html).toContain('Ritiro in negozio');
    expect(html).toMatch(/class="grid sm:grid-cols-2 gap-4 mb-10"/);
    expect(html).not.toMatch(/class="grid sm:grid-cols-3 gap-4 mb-10"/);
  });
  it('il tracciamento usa l\'etichetta di «I miei ordini»: col ritiro acceso «Pronto per il ritiro»', () => {
    expect(html).toContain('Pronto per il ritiro');
    expect(html).not.toContain('Pronto per il ritiro / la consegna');
  });
});
