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

/** 25/11/2026, 18:30 — Nicola: nel preventivo descrizioni corte, solo lo stretto necessario. */
describe('nel preventivo l analisi del business è corta', () => {
  const voce = (t: string) => [{ testo: t, fonte: 'https://example.org/x' }];
  const analisi = {
    situazione: voce('Trattoria a conduzione familiare in via Roma.'), mercato: voce('Tre trattorie simili nel raggio di un chilometro.'),
    clienti: voce('Le recensioni lodano i tortelli fatti in casa.'), opportunita: voce('Il pranzo dei lavoratori della zona è scoperto.'),
    rischi: voce('Gli orari su Google non sono aggiornati.'), prime_mosse: voce('Aggiornare gli orari sulla scheda Google.'),
  };
  it('al massimo tre frasi, prima le mosse, la sola fascia guardata e il rimando alla pagina Analisi', () => {
    const html = renderToStaticMarkup(<AnalisiAziendale corta analisi={analisi} fascia="business" dettaglioHref="/seller/servizi/analisi" />);
    expect((html.match(/<li/g) ?? []).length).toBe(3);
    expect(html.indexOf('Aggiornare gli orari')).toBeLessThan(html.indexOf('Il pranzo dei lavoratori'));
    expect(html).not.toContain('Tre trattorie simili');
    expect(html).toContain(`Col ${FASCE.business.nome}:`);
    expect(html).not.toContain(`${FASCE.premium.nome}:`);
    expect(html).toContain('href="/seller/servizi/analisi"');
  });
});
