/**
 * LE PAGINE PER I FATTORINI DICONO COME LI PAGHIAMO DAVVERO.
 *
 * La pagina d'aiuto dei fattorini e «Lavora con noi» promettevano cose che il
 * codice non fa:
 *   ① «MyCity stipula una polizza RC per ogni rider» — ma l'iscrizione chiede
 *     al fattorino di caricare la SUA polizza, con la scadenza;
 *   ② «Base fissa + km percorsi» — il compenso è fisso (COMPENSO_RIDER_CENTS),
 *     la distanza non c'entra (Nicola, 20/8/2026);
 *   ③ «Bonifico mensile il giorno 5» / «pagato ogni settimana» — il giro dei
 *     pagamenti versa il compenso circa un'ora dopo la consegna;
 *   ④ «riepilogo PDF a fine mese» — nessun PDF esiste.
 * I numeri attesi si leggono dalle stesse costanti che usano i pagamenti:
 * se cambiano lì, la prova segue da sola.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import RiderHelpPage from '@/app/rider/help/page';
import LavoraConNoiPage from '@/app/lavora-con-noi/page';
import { COMPENSO_RIDER_CENTS, COMPENSO_RIDER_NEGOZIO_IN_PIU_CENTS } from '@/lib/constants';
import { formatPrice } from '@/lib/format';

/** Il testo visibile, senza tag e con gli spazi normalizzati. */
function testo(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/[\s  ]+/g, ' ');
}

const norm = (s: string) => s.replace(/[\s  ]+/g, ' ');

describe('aiuto fattorini: le promesse seguono il codice', () => {
  const aiuto = testo(renderToStaticMarkup(createElement(RiderHelpPage)));

  it('non promette una polizza pagata da MyCity', () => {
    expect(aiuto).not.toMatch(/MyCity stipula/i);
    expect(aiuto).not.toMatch(/polizza[^.]*(per ogni rider|la paghiamo|a carico (di )?MyCity)/i);
  });

  it('dice il compenso fisso vero, senza chilometri', () => {
    expect(aiuto).not.toMatch(/km percorsi|al km|a chilometr[oi] percors/i);
    expect(aiuto).toContain(norm(formatPrice(COMPENSO_RIDER_CENTS / 100)));
    expect(aiuto).toContain(norm(formatPrice(COMPENSO_RIDER_NEGOZIO_IN_PIU_CENTS / 100)));
  });

  it('non promette bonifici a date fisse né un PDF che non esiste', () => {
    expect(aiuto).not.toMatch(/giorno 5|mensile|ogni settimana/i);
    expect(aiuto).not.toMatch(/PDF/);
    expect(aiuto).toMatch(/un'ora dopo la consegna/);
  });

  it('per le emergenze resta il 112', () => {
    expect(aiuto).toMatch(/112/);
    expect(aiuto).not.toMatch(/0523 ?000000/);
  });
});

describe('«Lavora con noi» non promette pagamenti settimanali', () => {
  it('dice che il compenso arriva dopo ogni consegna', () => {
    const pagina = testo(renderToStaticMarkup(createElement(LavoraConNoiPage)));
    expect(pagina).not.toMatch(/ogni settimana|settimanal/i);
    expect(pagina).not.toMatch(/km percorsi/i);
  });
});
