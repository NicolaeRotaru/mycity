import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import AnalisiAziendale from '@/components/seller/AnalisiAziendale';
import { FASCE } from '@/lib/agenzia/preventivo';

/** 25/11/2026 — Nicola: nel preventivo anche l'analisi del business, con parte generale e parte specifica. */
describe('il riquadro dell analisi del business', () => {
  it('parte specifica con la fonte di ogni frase, e parte generale con le tre fasce', () => {
    const html = renderToStaticMarkup(
      <AnalisiAziendale
        nome="La Ragazzetta"
        fascia="business"
        analisi={{ situazione: [{ testo: 'Trattoria a conduzione familiare in via Roma.', fonte: 'https://laragazzetta.it/chi-siamo' }], mercato: [], clienti: [], opportunita: [], rischi: [], prime_mosse: [] }}
      />,
    );
    expect(html).toContain('Trattoria a conduzione familiare in via Roma.');
    expect(html).toContain('href="https://laragazzetta.it/chi-siamo"');
    expect(html).toContain('laragazzetta.it');
    expect(html).not.toContain('Il mercato e i concorrenti vicini');
    for (const f of ['base', 'business', 'premium'] as const) expect(html).toContain(`${FASCE[f].nome}: `);
  });
  it('senza analisi lo dice, senza inventare niente', () => {
    const html = renderToStaticMarkup(<AnalisiAziendale analisi={null} />);
    expect(html).toContain('la stiamo preparando');
    expect(html).toContain('Cosa comprende l’analisi');
  });
});
