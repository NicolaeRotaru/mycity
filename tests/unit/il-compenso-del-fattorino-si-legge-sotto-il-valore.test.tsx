// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * 30/10/2026 — NELLA PAGINA CONSEGNE DELL'AMMINISTRATORE LE FRASI LUNGHE NON STANNO NELL'ETICHETTA.
 *
 * L'etichetta della tessera (components/admin/AdminUI.tsx) è da 10 pixel, in maiuscolo, accanto
 * all'icona: ci sta un nome corto. «Compenso del fattorino: il giro, più 1 € per ogni negozio in
 * più» (circa 64 caratteri in circa 130 pixel) andava a capo su quattro righe. Adesso l'etichetta
 * dice solo di cosa si parla, e la spiegazione sta in una riga leggibile sotto il valore, con le
 * cifre prese dalle costanti.
 */

const ETICHETTA_LUNGA_AL_MASSIMO = 28;

async function pagina(): Promise<Document> {
  const { default: AdminDeliveryPage } = await import('@/app/admin/delivery/page');
  const html = renderToStaticMarkup(createElement(AdminDeliveryPage));
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('la pagina consegne dell’amministratore', () => {
  it('le etichette maiuscole da 10 pixel restano corte', async () => {
    const doc = await pagina();
    const etichette = Array.from(doc.querySelectorAll('span.uppercase')).map((e) => (e.textContent ?? '').trim());
    expect(etichette).toContain('Compenso del fattorino');
    for (const e of etichette) expect(e.length, `«${e}»`).toBeLessThanOrEqual(ETICHETTA_LUNGA_AL_MASSIMO);
  });

  it('la spiegazione del compenso si legge sotto il valore, in minuscolo, con le cifre delle costanti', async () => {
    const { COMPENSO_RIDER_CENTS, COMPENSO_RIDER_NEGOZIO_IN_PIU_CENTS } = await import('@/lib/constants');
    const doc = await pagina();
    const nota = Array.from(doc.querySelectorAll('p')).find((p) => /per ogni negozio in più/.test(p.textContent ?? ''));
    expect(nota, 'la riga del compenso sotto il valore').toBeTruthy();
    expect(nota!.closest('.uppercase')).toBeNull();
    expect(nota!.className).not.toMatch(/uppercase/);
    const cifra = (c: number) => String(c / 100).replace('.', ',');
    expect(nota!.textContent).toContain(cifra(COMPENSO_RIDER_CENTS));
    expect(nota!.textContent).toContain(cifra(COMPENSO_RIDER_NEGOZIO_IN_PIU_CENTS));
  });
});
