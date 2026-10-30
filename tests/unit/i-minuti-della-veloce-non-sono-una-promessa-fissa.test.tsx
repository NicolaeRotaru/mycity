import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { fraseComeArriva, rispostaTempiDiConsegna } from '@/lib/promesse-pubbliche';
import { VALUE_PROPS } from '@/lib/constants';
import { EXPRESS_ETA_LABEL } from '@/lib/delivery';
import PaginaConsegne from '@/app/admin/delivery/page';

/**
 * La consegna arriva nella fascia che il cliente sceglie; la veloce, in 30-60 minuti, c'è solo coi
 * negozi aperti e un fattorino in servizio (lib/ordini/consegna-veloce.ts, veloceSiPuo). Le domande
 * frequenti, le descrizioni Google dei negozi e delle categorie e la promessa «Consegna rapida»
 * dicevano i minuti come cosa certa, e in produzione non c'era nessun fattorino approvato.
 */
const promessaFissa = (t: string) => t.includes(EXPRESS_ETA_LABEL) && !/fattorino/.test(t);

describe('i minuti della veloce non sono una promessa fissa', () => {
  it('la frase dei metadati di negozi e categorie dice la fascia, e la veloce solo con un fattorino', () => {
    for (const attivo of [true, false]) {
      const f = fraseComeArriva(attivo);
      expect(f).toMatch(/fascia/);
      expect(promessaFissa(f), f).toBe(false);
    }
  });

  it('la risposta delle domande frequenti sui tempi dice la fascia, e quando c è la veloce', () => {
    const { a } = rispostaTempiDiConsegna();
    expect(a).toMatch(/fascia oraria che scegli/);
    expect(promessaFissa(a), a).toBe(false);
    expect(a).toMatch(/8 alle 21/);
  });

  it('le promesse in vetrina non vendono i 30-60 minuti come certi', () => {
    for (const p of VALUE_PROPS) expect(promessaFissa(`${p.title} ${p.subtitle}`), p.subtitle).toBe(false);
  });

  it('la pagina consegne dell amministratore dice la regola, non «3,00 €–4,00 €» a consegna', () => {
    const html = renderToStaticMarkup(createElement(PaginaConsegne));
    expect(html).not.toMatch(/3,00\s*€\s*–\s*4,00\s*€/);
    expect(html).toMatch(/per tutto il carrello/);
    expect(html).toMatch(/Ogni negozio in più/);
    expect(html).toMatch(/Spesa piccola/);
    expect(html).toMatch(/Consegna veloce/);
    expect(html).toMatch(/3,00\s*€ il giro \+ 1,00\s*€ a negozio in più/);
    expect(html).toMatch(/fanno\s*8,00\s*€/);
  });
});
