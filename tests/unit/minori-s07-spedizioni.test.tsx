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
  // R12-009 (28/11/2026) — Il tracciamento della pagina è la fila della consegna a casa (dopo «pronto»
  // viene «In consegna (con nome del rider)»): «I miei ordini» su un ordine a domicilio dice
  // `etichettaPronto(false)`. «Pronto per il ritiro» qui manderebbe in negozio chi aspetta a casa.
  it('il tracciamento usa l\'etichetta di «I miei ordini» per la consegna a casa: «Pronto per il fattorino»', () => {
    expect(html).toContain('Pronto per il fattorino');
    expect(html).not.toContain('Pronto per il ritiro');
  });
});
