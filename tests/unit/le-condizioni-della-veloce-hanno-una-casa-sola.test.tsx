import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * 30/10/2026 — LE CONDIZIONI DELLA VELOCE HANNO UNA CASA SOLA (ondata 18).
 *
 * La veloce si può dalle 8 alle 21, a negozi aperti, con un fattorino in servizio (`veloceSiPuo`).
 * La frase con le tre condizioni è QUANDO_SI_PUO_LA_VELOCE, ma cinque posti la riscrivevano a mano:
 * la descrizione Google dei negozi, il piede del sito, «Come funziona», le promesse della home ne
 * dicevano una sola su tre («con un fattorino in servizio»), e la spiegazione del carrello scriveva
 * «dalle 8 alle 21» a mano. Alle 15, col forno chiuso dall'una e Nicola in servizio, la veloce non
 * c'è: chi aveva letto «quando c'è un fattorino» la cercava in cassa.
 *
 * La prova sposta la chiusura della veloce alle 20 e chiede che ogni frase la segua da sola.
 */
vi.mock('@/lib/quando-arriva', async (orig) => ({ ...(await orig<object>()), CHIUSURA_EXPRESS: 20 }));

import { fraseComeArriva, spiegazioneDellaConsegna } from '@/lib/promesse-pubbliche';
import { CONSEGNA_FRASE_INTERA, QUANDO_SI_PUO_LA_VELOCE } from '@/lib/promessa-consegna';
import { DEFAULT_FOOTER_TAGLINE } from '@/lib/site-branding';
import { VALUE_PROPS } from '@/lib/constants';

const TRE_CONDIZIONI = [/dalle 8 alle 20\b/, /negozi[^.;]*aperti/, /fattorino in servizio/];

function diceLeTreCondizioni(t: string, dove: string) {
  for (const c of TRE_CONDIZIONI) expect(t, `${dove}: «${t}»`).toMatch(c);
  expect(t, `${dove} scrive ancora l'ora a mano`).not.toMatch(/alle 21\b/);
}

describe('spostata la chiusura della veloce alle 20, ogni frase la segue', () => {
  it('la casa unica', () => {
    expect(QUANDO_SI_PUO_LA_VELOCE).toBe('dalle 8 alle 20, a negozi aperti, con un fattorino in servizio');
  });

  it('la descrizione Google di negozi e categorie', () => {
    for (const attivo of [true, false]) diceLeTreCondizioni(fraseComeArriva(attivo), `fraseComeArriva(${attivo})`);
  });

  it('la spiegazione del carrello (il testo resta quello di oggi, l’ora nasce dalla costante)', () => {
    const veloce = spiegazioneDellaConsegna('').punti.find((p) => p.includes('veloce'));
    diceLeTreCondizioni(veloce ?? '', 'spiegazioneDellaConsegna');
  });

  it('la frase intera, il piede del sito e le promesse della home', () => {
    diceLeTreCondizioni(CONSEGNA_FRASE_INTERA, 'CONSEGNA_FRASE_INTERA');
    diceLeTreCondizioni(DEFAULT_FOOTER_TAGLINE, 'il piede del sito');
    const rapida = VALUE_PROPS.find((v) => v.icon === 'Zap');
    diceLeTreCondizioni(rapida?.subtitle ?? '', 'VALUE_PROPS');
  });

  it('«Come funziona», disegnata', async () => {
    const { default: ComeFunziona } = await import('@/app/come-funziona/page');
    const t = renderToStaticMarkup(createElement(ComeFunziona)).replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'");
    diceLeTreCondizioni(t.slice(t.indexOf('Ordini dai negozi'), t.indexOf('Ordini dai negozi') + 300), 'Come funziona');
  });
});
