import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * 30/10/2026 — LA FRASE «IN GIORNATA…» DELLA RIGA SENZA NEGOZIO ARRIVA DA UNA CASA SOLA.
 *
 * La guardia della copia unica (le-frasi-della-consegna-non-tornano-indietro) cerca la frase intera
 * nei file del sito: se qualcuno la riscrive a mano in DeliveryCutoff spezzata in due pezzi
 * («in giornata, » + «negli orari…»), quella prova resta verde. Qui si cambia la frase alla fonte
 * (lib/promesse-pubbliche) e la riga disegnata deve cambiare con lei: una copia a mano, intera o a
 * pezzi, non segue il cambio e la prova diventa rossa.
 */

vi.mock('@/lib/promesse-pubbliche', async (originale) => ({
  ...(await originale<typeof import('@/lib/promesse-pubbliche')>()),
  QUANDO_ARRIVA_SENZA_NEGOZIO: 'FRASE-CAMBIATA',
}));

function testo(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

describe('la riga della consegna senza negozio segue la frase della sua casa', () => {
  it('cambiata la frase in lib/promesse-pubbliche, DeliveryCutoff senza negozio scrive quella nuova', async () => {
    const { DeliveryCutoff, RIGA_CONSEGNA_SENZA_NEGOZIO } = await import('@/components/ui/DeliveryCutoff');
    expect(RIGA_CONSEGNA_SENZA_NEGOZIO).toBe('Consegna FRASE-CAMBIATA');
    for (const variant of ['inline', 'banner'] as const) {
      const html = renderToStaticMarkup(createElement(DeliveryCutoff, { senzaNegozio: true, variant }));
      expect(testo(html), `variante ${variant}`).toBe('Consegna FRASE-CAMBIATA');
    }
  });
});
