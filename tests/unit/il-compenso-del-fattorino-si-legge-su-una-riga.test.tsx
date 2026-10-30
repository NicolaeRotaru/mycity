import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { COMPENSO_RIDER_CENTS, COMPENSO_RIDER_NEGOZIO_IN_PIU_CENTS } from '@/lib/constants';

vi.mock('next/link', () => ({ default: ({ children }: { children?: unknown }) => children }));

/**
 * 30/10/2026 — NELLA PAGINA CONSEGNE DELL'AMMINISTRATORE IL COMPENSO DEL FATTORINO SI LEGGE SU UNA RIGA.
 *
 * Il riquadro scriveva «3,00 € il giro + 1,00 € a negozio in più» (circa 40 caratteri) a 26 pixel
 * con l'interlinea a 1, in una colonna di circa 200 pixel: tre o quattro righe che si toccano.
 * Il valore resta corto, la frase va nell'etichetta, e le cifre vengono dalle costanti.
 */

function riquadri(html: string): { etichetta: string; valore: string }[] {
  const fuori: { etichetta: string; valore: string }[] = [];
  const re = /<span class="text-\[10px\][^"]*">([^<]*)<\/span><\/div><p class="text-\[26px\][^"]*">([^<]*)<\/p>/g;
  for (const m of html.matchAll(re)) fuori.push({ etichetta: m[1], valore: m[2].replace(/&nbsp;| /g, ' ') });
  return fuori;
}

describe('il riquadro del compenso del fattorino', () => {
  it('valore corto con le cifre delle costanti, la frase lunga nell’etichetta', async () => {
    const { default: PaginaConsegne } = await import('@/app/admin/delivery/page');
    const html = renderToStaticMarkup(createElement(PaginaConsegne));
    const tutti = riquadri(html);
    expect(tutti.length, 'la prova deve trovare i riquadri della pagina').toBeGreaterThan(1);
    const compenso = tutti.find((r) => /compenso del fattorino/i.test(r.etichetta));
    expect(compenso, 'manca il riquadro del compenso del fattorino').toBeDefined();
    const giro = COMPENSO_RIDER_CENTS / 100;
    const inPiu = COMPENSO_RIDER_NEGOZIO_IN_PIU_CENTS / 100;
    expect(compenso!.valore).toBe(`${giro} € + ${inPiu} €`);
    expect(compenso!.valore.length, `«${compenso!.valore}» non sta su una riga`).toBeLessThanOrEqual(12);
    // 30/10/2026 (ondata 17) — La frase lunga nell'etichetta da 10 pixel in maiuscolo andava a capo su
    // quattro righe: l'etichetta dice di cosa si parla, la frase sta nella riga sotto il valore
    // (prova: il-compenso-del-fattorino-si-legge-sotto-il-valore).
    expect(compenso!.etichetta).toBe('Compenso del fattorino');
    expect(html).toMatch(new RegExp(`<p class="mt-2[^"]*">${giro}\\s€ il giro, più ${inPiu}\\s€ per ogni negozio in più</p>`));
  });
});
