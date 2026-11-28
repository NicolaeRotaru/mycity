import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import RiderHelpPage from '@/app/rider/help/page';
import { COMPENSO_RIDER_CENTS, COMPENSO_RIDER_NEGOZIO_IN_PIU_CENTS } from '@/lib/constants';
import { formatPrice } from '@/lib/format';

/**
 * N-001 (onda 2) — L'aiuto dei fattorini, alla domanda sulla mancia, diceva «la piattaforma garantisce
 * un compenso fisso per consegna». Non è vero così: il compenso è per giro (3 € + 1 € per ogni negozio
 * in più, non per ogni ordine), coi contanti il fattorino lo trattiene dall'incasso, e arriva solo per
 * le consegne completate (lib/stripe/payout.ts). Una promessa di guadagno garantito a un lavoratore
 * autonomo è proprio la frase da non scrivere.
 */
const testo = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/[\s  ]+/g, ' ');
const norm = (s: string) => s.replace(/[\s  ]+/g, ' ');

describe('N-001 · la risposta sulla mancia non promette un compenso garantito', () => {
  const pagina = testo(renderToStaticMarkup(createElement(RiderHelpPage)));
  const risposta = pagina.slice(pagina.indexOf('Posso chiedere mancia?'), pagina.indexOf('Guadagni e bonifici'));

  it('non dice «garantisce» né «per consegna»', () => {
    expect(risposta).toContain('Posso chiedere mancia?');
    expect(risposta).not.toMatch(/garantisc/i);
    expect(risposta).not.toMatch(/compenso fisso per consegna/i);
  });

  it('dice il compenso vero: per giro, coi numeri dei pagamenti, per le consegne completate', () => {
    expect(risposta).toContain(norm(formatPrice(COMPENSO_RIDER_CENTS / 100)));
    expect(risposta).toContain(norm(formatPrice(COMPENSO_RIDER_NEGOZIO_IN_PIU_CENTS / 100)));
    expect(risposta).toMatch(/per ogni giro di consegna/);
    expect(risposta).toMatch(/consegne completate/);
  });
});
