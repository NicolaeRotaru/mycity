import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { promessaSpedizione } from '@/lib/promesse-pubbliche';
import { DeliveryCutoff } from '@/components/ui/DeliveryCutoff';
import {
  CONSEGNA_NEGOZIO_IN_PIU_CENTS,
  PLATFORM_DELIVERY_FEE_CENTS,
  SPESA_SENZA_SUPPLEMENTO_CENTS,
  SUPPLEMENTO_CONSEGNA_CENTS,
  SUPPLEMENTO_VELOCE_CENTS,
} from '@/lib/constants';

const eur = (c: number) => (c / 100).toFixed(2).replace('.', ',');

describe('R08-002 il riquadro verde della scheda sul telefono', () => {
  it('la frase del costo di consegna sta sotto i 200 caratteri (prima 264)', () => {
    const d = promessaSpedizione().dettaglioConsegna!;
    expect(d.length).toBeLessThan(200);
  });
  it('ogni importo e ogni condizione della tariffa restano nella frase', () => {
    const d = promessaSpedizione().dettaglioConsegna!;
    for (const c of [
      PLATFORM_DELIVERY_FEE_CENTS,
      CONSEGNA_NEGOZIO_IN_PIU_CENTS,
      SUPPLEMENTO_CONSEGNA_CENTS,
      SUPPLEMENTO_VELOCE_CENTS,
      SPESA_SENZA_SUPPLEMENTO_CENTS,
    ]) expect(d).toContain(eur(c));
    expect(d).toContain('per tutto il carrello');
    expect(d).toContain('per ogni negozio in più');
    expect(d).toContain('veloce');
    expect(d).toContain('compresa se un negozio è sotto');
    expect(d).toContain('all’ora che scegli');
  });
  it('la riga della consegna in linea tiene lo spazio di due righe a ogni larghezza', () => {
    const html = renderToStaticMarkup(createElement(DeliveryCutoff, { variant: 'inline' }));
    expect(html).toContain('min-h-[2.5rem]');
    expect(html).not.toContain('sm:min-h-0');
  });
});
